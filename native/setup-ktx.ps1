<#
  Prepare the private KTX Python runtime without changing system Python, PATH or registry.
  -CheckOnly checks imports offline; -Plan reports fixed paths without changing anything.
  Official uv archive and digest: https://github.com/astral-sh/uv/releases/tag/0.13.7
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Plan
)

$ErrorActionPreference = 'Stop'
if ($CheckOnly -and $Plan) { throw 'Use only one of -CheckOnly or -Plan.' }
$ktxNativeDir = [IO.Path]::GetFullPath($PSScriptRoot)
$ktxRuntimeDir = Join-Path $ktxNativeDir 'ktx-runtime'
$ktxSourceDir = Join-Path $ktxNativeDir 'ktx-python'
$ktxPython = Join-Path $ktxRuntimeDir '.venv\Scripts\python.exe'
$ktxWorker = Join-Path $ktxSourceDir 'worker.py'
$ktxLock = Join-Path $ktxSourceDir 'uv.lock'
$ktxUvVersion = '0.13.7'
$ktxPythonVersion = '3.12.12'
$ktxArchiveName = 'uv-x86_64-pc-windows-msvc.zip'
$ktxArchiveSha256 = '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021'
$ktxArchiveUrl = "https://github.com/astral-sh/uv/releases/download/$ktxUvVersion/$ktxArchiveName"

function Assert-KtxFileHash([string]$LiteralPath, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash
  if ($actual -ne $Expected) { throw "KTX runtime download checksum mismatch: $LiteralPath" }
}

function Invoke-KtxImportCheck {
  if (-not (Test-Path -LiteralPath $ktxPython -PathType Leaf)) {
    throw 'KTX Python runtime is missing. Run native/setup-ktx.ps1 first.'
  }
  if (-not (Test-Path -LiteralPath $ktxWorker -PathType Leaf)) {
    throw 'The bundled KTX worker.py is missing. Restore the extension files and run setup again.'
  }
  $checkOutput = & $ktxPython -I $ktxWorker --check
  if ($LASTEXITCODE -ne 0) { throw "KTX Python import check failed (exit $LASTEXITCODE)." }
  try { $check = ($checkOutput -join "`n") | ConvertFrom-Json } catch {
    throw 'KTX Python import check did not return a JSON response.'
  }
  if ($check.ok -ne $true) { throw "KTX Python import check failed: $($check.error)" }
  return $check
}

if ($Plan) {
  [ordered]@{
    runtime = $ktxRuntimeDir
    source = $ktxSourceDir
    python = $ktxPython
    pythonVersion = $ktxPythonVersion
    uvVersion = $ktxUvVersion
    archive = $ktxArchiveUrl
    sha256 = $ktxArchiveSha256
    environment = (Join-Path $ktxRuntimeDir '.venv')
    managedPython = (Join-Path $ktxRuntimeDir 'python')
    lock = $ktxLock
  } | ConvertTo-Json
  return
}

if ($CheckOnly) {
  Invoke-KtxImportCheck | ConvertTo-Json -Depth 5
  return
}

$ktxArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($ktxArch -ne 'AMD64') { throw 'The bundled KTX runtime currently supports Windows x64 only.' }
foreach ($required in @($ktxWorker, $ktxLock, (Join-Path $ktxSourceDir 'pyproject.toml'))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing bundled KTX runtime file: $required" }
}

# All uv state lives beside this bridge. Never target an inherited system/active environment.
$ktxEnv = @{
  UV_PROJECT_ENVIRONMENT = (Join-Path $ktxRuntimeDir '.venv')
  UV_PYTHON_INSTALL_DIR = (Join-Path $ktxRuntimeDir 'python')
  UV_PYTHON_BIN_DIR = (Join-Path $ktxRuntimeDir 'bin')
  UV_CACHE_DIR = (Join-Path $ktxRuntimeDir 'cache')
  UV_NO_ENV_FILE = '1'
  UV_NO_CONFIG = '1'
  UV_PYTHON_DOWNLOADS = 'automatic'
  PYTHONPATH = $null
  PYTHONHOME = $null
  VIRTUAL_ENV = $null
}
$ktxOldEnv = @{}
$ktxOldProgress = $ProgressPreference
$ktxOldTls = [Net.ServicePointManager]::SecurityProtocol
try {
  foreach ($key in $ktxEnv.Keys) {
    $ktxOldEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $ktxEnv[$key], 'Process')
  }
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = $ktxOldTls -bor [Net.SecurityProtocolType]::Tls12
  $ktxBootstrapDir = Join-Path $ktxRuntimeDir "bootstrap\uv-$ktxUvVersion"
  New-Item -ItemType Directory -Path $ktxBootstrapDir -Force | Out-Null
  $ktxArchive = Join-Path $ktxBootstrapDir $ktxArchiveName
  if (-not (Test-Path -LiteralPath $ktxArchive -PathType Leaf)) {
    Write-Host "Downloading private uv $ktxUvVersion..."
    $ktxPartial = "$ktxArchive.partial"
    Invoke-WebRequest -Uri $ktxArchiveUrl -OutFile $ktxPartial -UseBasicParsing -TimeoutSec 180
    Assert-KtxFileHash -LiteralPath $ktxPartial -Expected $ktxArchiveSha256
    Move-Item -LiteralPath $ktxPartial -Destination $ktxArchive -Force
  }
  # Verify cached archives too; do not execute an unchecked cached bootstrap binary.
  Assert-KtxFileHash -LiteralPath $ktxArchive -Expected $ktxArchiveSha256
  Expand-Archive -LiteralPath $ktxArchive -DestinationPath $ktxBootstrapDir -Force
  $ktxUv = Join-Path $ktxBootstrapDir 'uv.exe'
  if (-not (Test-Path -LiteralPath $ktxUv -PathType Leaf)) { throw 'uv.exe is missing from the verified archive.' }

  Write-Host "Preparing private Python $ktxPythonVersion..."
  & $ktxUv python install $ktxPythonVersion --no-bin --no-registry --no-config
  if ($LASTEXITCODE -ne 0) { throw "Python installation failed (exit $LASTEXITCODE). Run setup again to retry." }
  & $ktxUv sync --project $ktxSourceDir --locked --no-dev --no-install-project --managed-python --python $ktxPythonVersion --no-config
  if ($LASTEXITCODE -ne 0) { throw "KTX dependency installation failed (exit $LASTEXITCODE). Run setup again to retry." }
  $ktxCheck = Invoke-KtxImportCheck
  $ktxMetadata = [ordered]@{
    python = $ktxPythonVersion
    uv = $ktxUvVersion
    lockSha256 = (Get-FileHash -LiteralPath $ktxLock -Algorithm SHA256).Hash.ToLowerInvariant()
    installedAt = [DateTime]::UtcNow.ToString('o')
  }
  [IO.File]::WriteAllText((Join-Path $ktxRuntimeDir 'runtime.json'), ($ktxMetadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Write-Host "KTX runtime ready: $ktxPython"
  $ktxCheck | ConvertTo-Json -Depth 5
} finally {
  foreach ($key in $ktxOldEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $ktxOldEnv[$key], 'Process') }
  $ProgressPreference = $ktxOldProgress
  [Net.ServicePointManager]::SecurityProtocol = $ktxOldTls
}

