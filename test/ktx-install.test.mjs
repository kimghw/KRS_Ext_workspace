// Installer checks run offline in a private directory with spaces. Registry
// cmdlets are shadowed before install.ps1 runs; no real registration is changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const source = new URL('../native/setup-ktx.ps1', import.meta.url);
const installSource = new URL('../native/install.ps1', import.meta.url);
const launcherSource = new URL('../native/claude-bridge.bat', import.meta.url);
const windows = process.platform === 'win32';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const registryKeys = [
  'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.krs.meetingroom',
  'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.krs.meetingroom',
];
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const powershell = (args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
  encoding: 'utf8', timeout: 15_000, windowsHide: true,
});
function fixture(t) {
  // TEMP can use an 8.3 alias on Windows; PowerShell expands PSScriptRoot to the
  // long path. Give both sides the same real directory before comparing paths.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'krs ktx installer ')));
  const script = path.join(dir, 'setup-ktx.ps1');
  fs.copyFileSync(source, script);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, script };
}

test('KTX setup plans a private pinned runtime without browser registration or system Python changes', { skip: !windows }, (t) => {
  const { dir, script } = fixture(t);
  const run = powershell(['-File', script, '-Plan']);
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.runtime, path.join(dir, 'ktx-runtime'));
  assert.equal(plan.python, path.join(plan.runtime, '.venv', 'Scripts', 'python.exe'));
  assert.equal(plan.managedPython, path.join(plan.runtime, 'python'));
  assert.equal(plan.lock, path.join(dir, 'ktx-python', 'uv.lock'));
  assert.equal(plan.registryKeys, undefined);
  assert.equal(plan.manifest, undefined);
  assert.match(plan.pythonVersion, /^3\.12\.\d+$/);
  assert.equal(plan.archive, `https://github.com/astral-sh/uv/releases/download/${plan.uvVersion}/uv-x86_64-pc-windows-msvc.zip`);
  assert.match(plan.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(fs.readdirSync(dir), ['setup-ktx.ps1']);
});

test('offline runtime check fails clearly when missing, without starting installation', { skip: !windows }, (t) => {
  const { dir, script } = fixture(t);
  const run = powershell(['-File', script, '-CheckOnly']);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /KTX Python runtime is missing/);
  assert.deepEqual(fs.readdirSync(dir), ['setup-ktx.ps1']);
});

test('bootstrap verification accepts the expected digest and rejects changed bytes before execution', { skip: !windows }, (t) => {
  const { dir, script } = fixture(t);
  const archive = path.join(dir, 'download.zip');
  fs.writeFileSync(archive, 'trusted fixture');
  const hash = crypto.createHash('sha256').update('trusted fixture').digest('hex');
  const check = path.join(dir, 'hash-check.ps1');
  fs.writeFileSync(check, `$null = . ${quote(script)} -Plan\nAssert-KtxFileHash -LiteralPath ${quote(archive)} -Expected '${hash}'\n`);
  assert.equal(powershell(['-File', check]).status, 0);
  fs.appendFileSync(archive, ' changed');
  const bad = powershell(['-File', check]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(dir, 'ktx-runtime')), false);
});

function installFixture(t, { setupFails = false, setupMissing = false } = {}) {
  const result = fixture(t);
  result.installer = path.join(result.dir, 'install.ps1');
  result.manifest = path.join(result.dir, 'com.krs.meetingroom.json');
  result.launcher = path.join(result.dir, 'claude-bridge.bat');
  result.profile = path.join(result.dir, 'ktx-runtime', 'retained-profile');
  fs.copyFileSync(installSource, result.installer);
  fs.copyFileSync(launcherSource, result.launcher);
  // No project packages or legacy host in this fixture: the batch must target entry.mjs.
  fs.writeFileSync(path.join(result.dir, 'entry.mjs'), "process.stdout.write('entry-fixture');\n");
  fs.writeFileSync(path.join(result.dir, 'host.mjs'), "throw new Error('unexpected legacy entry');\n");
  fs.mkdirSync(path.dirname(result.profile));
  fs.writeFileSync(result.profile, 'retained browser profile');
  if (setupMissing) fs.unlinkSync(result.script);
  else fs.writeFileSync(result.script, `
$global:ktxFixtureSetupCalls++
if ($global:ktxFixtureAllowedKeys | Where-Object { -not $global:ktxFixtureRegistry.ContainsKey($_) }) {
  throw 'Bridge must be registered before optional KTX setup'
}
${setupFails ? "throw 'fixture Python dependency failure'" : "Write-Host 'fixture KTX runtime ready'"}
`);
  return result;
}

function installScenario(f, scenario, { nodeAvailable = true, claudeAvailable = true } = {}) {
  const wrapper = path.join(f.dir, 'registry-fixture.ps1');
  fs.writeFileSync(wrapper, `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$global:ktxFixtureRegistry = @{}
$global:ktxFixtureCalls = [Collections.Generic.List[object]]::new()
$global:ktxFixtureWarnings = [Collections.Generic.List[string]]::new()
$global:ktxFixtureAllowedKeys = @(${registryKeys.map(quote).join(', ')})
$global:ktxFixtureSetupCalls = 0
function Assert-FixtureRegistryKey([string]$Key) {
  if ($global:ktxFixtureAllowedKeys -notcontains $Key) { throw "Unexpected registry access: $Key" }
}
function Test-Path {
  [CmdletBinding()]param([Parameter(Position=0)][string]$Path, [string]$LiteralPath, [string]$PathType)
  $target = if ($LiteralPath) { $LiteralPath } else { $Path }
  if ($target -like 'HKCU:*' -or $target -like 'HKLM:*') {
    Assert-FixtureRegistryKey $target
    return $global:ktxFixtureRegistry.ContainsKey($target)
  }
  Microsoft.PowerShell.Management\\Test-Path @PSBoundParameters
}
function New-Item {
  param([string]$Path, [switch]$Force)
  Assert-FixtureRegistryKey $Path
  $global:ktxFixtureRegistry[$Path] = @{}
  $global:ktxFixtureCalls.Add(@{ op = 'create'; key = $Path })
}
function Get-ItemProperty {
  [CmdletBinding()]param([Parameter(Position=0)][string]$Path, [string]$LiteralPath)
  $target = if ($LiteralPath) { $LiteralPath } else { $Path }
  if ($target -like '*\\App Paths\\*') { throw 'fixture browser installation not found' }
  Assert-FixtureRegistryKey $target
  [pscustomobject]$global:ktxFixtureRegistry[$target]
}
function Set-ItemProperty {
  param([string]$Path, [string]$Name, $Value)
  Assert-FixtureRegistryKey $Path
  $global:ktxFixtureRegistry[$Path][$Name] = $Value
  $global:ktxFixtureCalls.Add(@{ op = 'set'; key = $Path; name = $Name; value = $Value })
}
function Invoke-WebRequest { throw 'Unexpected network access' }
function Get-Command {
  [CmdletBinding()]param([Parameter(Position=0)][string]$Name)
  if ($Name -eq 'node') { ${nodeAvailable ? "return [pscustomobject]@{ Name = 'node' }" : 'return $null'} }
  if ($Name -eq 'claude') { ${claudeAvailable ? "return [pscustomobject]@{ Name = 'claude' }" : 'return $null'} }
  throw "Unexpected dependency lookup: $Name"
}
function Write-Warning { param([string]$Message) $global:ktxFixtureWarnings.Add($Message) }
$result = @{}
try {
${scenario}
} catch {
  $result.error = $_.Exception.Message
}
$result.registry = $global:ktxFixtureRegistry
$result.calls = @($global:ktxFixtureCalls.ToArray())
$result.warnings = @($global:ktxFixtureWarnings.ToArray())
$result.setupCalls = $global:ktxFixtureSetupCalls
$result.manifestExists = [IO.File]::Exists(${quote(f.manifest)})
Write-Output ('KTX_TEST_RESULT:' + ($result | ConvertTo-Json -Depth 10 -Compress))
`);
  const run = powershell(['-File', wrapper]);
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  const line = run.stdout.split(/\r?\n/).find(value => value.startsWith('KTX_TEST_RESULT:'));
  assert.ok(line, run.stdout);
  return JSON.parse(line.slice('KTX_TEST_RESULT:'.length));
}

function assertSharedRegistration(f, result) {
  assert.equal(result.error, undefined);
  assert.equal(result.manifestExists, true);
  assert.deepEqual(Object.keys(result.registry).sort(), [...registryKeys].sort());
  for (const key of registryKeys) assert.equal(result.registry[key]['(default)'], f.manifest);
  const bytes = fs.readFileSync(f.manifest);
  assert.notEqual(bytes[0], 0xef, 'native manifest must not have a UTF-8 BOM');
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
    name: 'com.krs.meetingroom', description: 'KRS WORKSPACE - 로컬 Claude CLI 다리',
    path: f.launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`],
  });
  assert.equal(fs.readFileSync(f.profile, 'utf8'), 'retained browser profile');
}

test('default installation shares the existing bridge and prepares KTX even without Claude CLI', { skip: !windows }, (t) => {
  const f = installFixture(t);
  const result = installScenario(f, `
& ${quote(f.installer)} -ExtensionId '${extensionId}'
$env:PATH = ${quote(path.dirname(process.execPath))}
$result.launcherOutput = (& ${quote(f.launcher)}) -join ''
$result.launcherExit = $LASTEXITCODE
`, { claudeAvailable: false });
  assertSharedRegistration(f, result);
  assert.equal(result.setupCalls, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /claude CLI/);
  assert.equal(result.launcherOutput, 'entry-fixture');
  assert.equal(result.launcherExit, 0);
});

test('SkipKtx registers the existing bridge without requiring any KTX setup files', { skip: !windows }, (t) => {
  const f = installFixture(t, { setupMissing: true });
  const result = installScenario(f, `& ${quote(f.installer)} -ExtensionId '${extensionId}' -SkipKtx`);
  assertSharedRegistration(f, result);
  assert.equal(result.setupCalls, 0);
  assert.deepEqual(result.warnings, []);
});

test('KTX installation failure leaves existing bridge registration available with a clear retry notice', { skip: !windows }, (t) => {
  const f = installFixture(t, { setupFails: true });
  const result = installScenario(f, `& ${quote(f.installer)} -ExtensionId '${extensionId}'`);
  assertSharedRegistration(f, result);
  assert.equal(result.setupCalls, 1);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /fixture Python dependency failure/);
  assert.match(result.warnings[1], /기존 브릿지 등록은 완료/);
});

test('adding KTX to an already registered bridge preserves its manifest and registration timestamp', { skip: !windows }, (t) => {
  const f = installFixture(t);
  const result = installScenario(f, `
& ${quote(f.installer)} -ExtensionId '${extensionId}' -SkipKtx
$result.firstWrites = $global:ktxFixtureCalls.Count
$result.firstTimestamp = [IO.File]::GetLastWriteTimeUtc(${quote(f.manifest)}).Ticks
& ${quote(f.installer)} -ExtensionId '${extensionId}'
$result.secondWrites = $global:ktxFixtureCalls.Count
$result.secondTimestamp = [IO.File]::GetLastWriteTimeUtc(${quote(f.manifest)}).Ticks
`);
  assertSharedRegistration(f, result);
  assert.equal(result.setupCalls, 1);
  assert.equal(result.firstWrites, result.secondWrites);
  assert.equal(result.firstTimestamp, result.secondTimestamp);
});

test('missing Node stops before registering an unusable bridge or installing KTX', { skip: !windows }, (t) => {
  const f = installFixture(t);
  const result = installScenario(f, `& ${quote(f.installer)} -ExtensionId '${extensionId}'`, { nodeAvailable: false });
  assert.match(result.error, /node/);
  assert.equal(result.setupCalls, 0);
  assert.equal(result.manifestExists, false);
  assert.deepEqual(result.calls, []);
});

test('invalid extension IDs stop before shared registration or optional runtime setup', { skip: !windows }, (t) => {
  const f = installFixture(t);
  const result = installScenario(f, `& ${quote(f.installer)} -ExtensionId 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP'`);
  assert.ok(result.error);
  assert.equal(result.setupCalls, 0);
  assert.equal(result.manifestExists, false);
  assert.deepEqual(result.calls, []);
});
