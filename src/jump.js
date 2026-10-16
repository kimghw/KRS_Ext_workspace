// 관문이 막은 "빈 곳"으로 바로 가는 단추(2026-10-16 사용자 지정: "반드시 들어가야 하는 거면 빈곳을 찾아갈 수 있는 바로가기 버튼을 넣어줘").
//
// 행위 층(actions/)의 관문은 무엇이 비었는지를 ActionError.missing([{ where: 'input' | 'preset', key, why }])으로 돌려준다. 어디로 가면 채울 수 있는지는
// 패널만 안다(내 이름은 설정 → 일반의 내 이름 칸, 공문 설정은 공문 탭의 공문 설정 칸, 폼의 칸은 그 칸) — 패널이 표(table)로 주면 여기서 둘을 맞춰
// 상태줄 끝에 단추를 세운다. 누르면 그 자리로 옮기고 잠깐 윤곽선을 켠다(flashFocus).
//
//   jumpsOf(err, entry, table)   관문 오류 → [{ where, key, why, label, go }]   (순수 — DOM 없음)
//   paintJumps(statusEl, jumps)  상태줄 끝에 단추를 세운다(없으면 걷는다)
//   flashFocus(node)             그 자리로 옮기고 초점을 두며 윤곽선을 잠깐 켠다
//
// table 의 꼴: { input: { 칸: go | { label, go } }, preset: { 키: go | { label, go } }, field: (뿌리 칸, 전체 키) => go | null }
//   input·preset 은 이름으로 바로 찾는 것, field 는 폼처럼 칸이 많아 이름 규칙(data-key)으로 찾는 것의 뒤받침이다.
//   키가 draft.total 처럼 안쪽 칸이면 뿌리(draft)로 input 을 먼저 보고, 없으면 field(뿌리, 전체 키)에 맡긴다.

/** 관문 오류가 가진 빈 곳 목록. ActionError 가 아니면 빈 목록. */
export const missingOf = (err) => (Array.isArray(err?.missing) ? err.missing : []);

/** 설명의 첫 마디 — "HR 의 나(사번·이름 — …)" 에서 "HR 의 나". 단추에 쓸 짧은 이름이다. */
const firstClause = (s) => String(s || '').split(/[(—:·,]/)[0].trim().slice(0, 14);

/** 안쪽 칸까지 내려가 label 을 찾는다 — draft.total 이면 fields.draft.fields.total. */
function fieldOf(entry, key) {
  let fields = entry?.fields || {};
  let f = null;
  for (const part of String(key).replace(/\[\d+\]/g, '').split('.')) {
    f = fields?.[part] || null;
    if (!f) return null;
    fields = f.fields || f.item || null;
  }
  return f;
}

/** 단추에 적을 칸 이름 — 칸의 label, 없으면 desc 의 첫 마디, 그것도 없으면 키. */
export function labelOf(entry, where, key) {
  if (where === 'preset') return firstClause(entry?.preset?.[key]?.desc) || key;
  const f = fieldOf(entry, key);
  return f?.label || firstClause(f?.desc) || key;
}

const asGo = (v) => (typeof v === 'function' ? { go: v } : v && typeof v.go === 'function' ? v : null);

/**
 * 관문 오류를 단추 목록으로. 같은 자리는 한 번만(차례는 오류의 차례), 갈 곳을 모르는 것은 뺀다.
 * @param {{missing?: object[]}} err 관문의 ActionError(아니면 빈 목록)
 * @param {object|null} entry 행위 명세(라벨용 — 없어도 된다)
 * @param {{input?: object, preset?: object, field?: Function}} [table]
 * @returns {{where: string, key: string, why: string, label: string, go: Function}[]}
 */
export function jumpsOf(err, entry, table = {}) {
  const out = [];
  const seen = new Set();
  for (const m of missingOf(err)) {
    const full = String(m?.key || '');
    const root = full.split(/[.[]/)[0];
    if (!root) continue;
    const where = m.where === 'preset' ? 'preset' : 'input';
    const id = `${where}:${root}`;
    if (seen.has(id)) continue;
    const hit = where === 'preset' ? asGo(table.preset?.[root]) : asGo(table.input?.[root]) || asGo(typeof table.field === 'function' ? table.field(root, full) : null);
    if (!hit) continue;
    seen.add(id);
    const label = hit.label || labelOf(entry, where, root);
    out.push({ where, key: root, why: String(m.why || 'missing'), label, go: hit.go });
  }
  return out;
}

/** 단추 글 — 비었으면 "채우기", 틀렸으면 "고치기". */
const verbOf = (why) => (why === 'invalid' || why === 'check' || why === 'variant' ? '고치기' : '채우기');

/**
 * 상태줄 끝에 단추를 세운다. 글(textContent)은 그대로 두고 뒤에 붙인다 — 상태줄을 다시 쓰면(setStatus) 같이 사라진다.
 * 단추가 없으면 앞서 세운 것만 걷는다.
 */
export function paintJumps(statusEl, jumps) {
  if (!statusEl) return;
  statusEl.querySelector('.jumps')?.remove();
  if (!jumps?.length) return;
  const doc = statusEl.ownerDocument;
  const box = doc.createElement('span');
  box.className = 'jumps';
  for (const j of jumps) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'jump';
    b.dataset.jump = `${j.where}:${j.key}`;
    b.textContent = `${j.label} ${verbOf(j.why)} →`;
    b.addEventListener('click', () => j.go());
    box.appendChild(b);
  }
  statusEl.appendChild(box);
}

/**
 * 그 자리로 옮기고 초점을 둔다. node 가 입력 칸이 아니면(묶음·카드) 안의 첫 입력 칸에 초점을 두고 node 에 윤곽선을 켠다.
 * @returns {boolean} 자리가 있었는가
 */
export function flashFocus(node, { ms = 1800 } = {}) {
  if (!node) return false;
  const focusable = 'input:not([type="hidden"]), select, textarea, button, [tabindex]';
  const target = typeof node.matches === 'function' && node.matches(focusable) ? node : node.querySelector?.(focusable) || node;
  // 접힌 상자(details) 안이면 편다 — 안 보이는 칸에 초점을 둘 수 없다.
  for (let d = node.closest?.('details'); d; d = d.parentElement?.closest?.('details')) d.open = true;
  node.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  node.classList?.add('jump-flash');
  setTimeout(() => node.classList?.remove('jump-flash'), ms);
  return true;
}
