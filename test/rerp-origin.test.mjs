// rerp/ 폴더는 kr_ext_rerp 에서 옮겨 온 코드다(rerp/README.md). 원본(E:\dev\kr_ext_rerp, 또는 환경변수 KR_EXT_RERP)이 옮긴 뒤로 바뀌었으면 여기서 빨갛게 알린다 —
// 바뀐 원본 파일을 rerp/README.md 의 "갱신" 차례대로 rerp/ 에 반영한 뒤 `node tools/rerp.mjs stamp` 로 지문을 다시 적으면 녹색이 된다.
// 원본이 없는 PC 에서는 견주지 못하므로 그냥 지나간다(옮긴 기준만 적는다). 어디에도 보내지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MAP, readOrigin, compare } from '../tools/rerp.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const origin = readOrigin();
const source = path.resolve(process.env.KR_EXT_RERP || 'E:/dev/kr_ext_rerp');

t('origin.json 은 옮긴 파일마다 출처·지문을 적고, 옮긴 자리(rerp/*)는 다 있다', () => {
  assert.equal(origin.source, 'kr_ext_rerp');
  assert.ok(/^\d+\.\d+\.\d+$/.test(origin.version), origin.version);
  assert.deepEqual(origin.files.map((f) => f.from), MAP.map((m) => m.from));
  for (const f of origin.files) {
    assert.match(f.sha1, /^[0-9a-f]{40}$/, f.from);
    for (const to of f.to.split(' · ')) assert.ok(fs.existsSync(new URL(`../${to}`, import.meta.url)), `${to} 가 없다`);
  }
});
t('옮긴 모듈은 chrome 전역에 기대지 않고 Node 에서 읽힌다(사이드패널·검사 어디서나 같은 파일)', async () => {
  for (const m of ['fmt', 'mcp', 'onenote', 'plansync', 'plan', 'planui', 'erp', 'plussync', 'research', 'researchsync']) await import(`../rerp/${m}.js`);
});
t(`원본(${source})이 옮긴 뒤로 바뀌지 않았다 — 바뀌었으면 rerp/ 에 반영하고 node tools/rerp.mjs stamp`, () => {
  const r = compare(source, origin);
  if (r.missing) {
    console.log(`      (원본이 없어 견주지 못함 — rerp/ 는 ${origin.source} ${origin.version} ${origin.commit} ${origin.commitDate} 기준)`);
    return;
  }
  assert.deepEqual(r.changed.map((c) => c.from), [], `kr_ext_rerp 의 이 파일들이 rerp/ 를 옮긴 뒤(${origin.commit} ${origin.commitDate})로 바뀌었습니다 — rerp/README.md "갱신" 을 보고 rerp/ 에 반영한 뒤 \`node tools/rerp.mjs stamp\`: ${r.changed.map((c) => c.from).join(', ')}`);
});

console.log(`\n${pass} passed`);
