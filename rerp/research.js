// kr_ext_rerp `lib/research.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_RESEARCH = …` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* 연구개발계획서(연구내용) 참조 (0.8.5) — RND 폴더의 연구개발계획서 스냅샷 KR_<과제>.yaml(/rnd-kr-extract 산출물, kr_ext_workspace R&D 탭이 넣는 것과 같은 파일)을
 * 설정 페이지에 넣어 두고, 과제의 연구 내용과 연구활동비 세부사용계획을 참조로 쓴다. 설정 페이지 · 패널(eClass 콘텐츠스크립트 / 팝업) · 백그라운드(lib/prep-ai.js) 공용.
 *  storage.local.researchPlans = { [id]: rec }  id = 과제명 키 + '#' + 차년도 (같은 과제의 다른 차년도는 따로 남는다)
 *   rec = { id, name(과제명), code(연구개발과제번호 RS-…), n(차년도), rev, tag(머리 주석의 [1차년도 최초] 등), file, at(넣은 시각), agree(협약일), period(기간 글),
 *           role(KR 역할), lead(KR 책임자), note(부처 · 사업 · 주관),
 *           goals[개발목표], contents[{ item, details[] }], perf[{ name, target, unit, method }], outputs[], schedule{ months, items[{ name, weeks, from, to }] }|null,
 *           spend[{ name, kind(구분), method(방식), qty, amount(원), period }](연구활동비 세부사용계획), budget[{ item, plan(원) }](비목별, 소계·총액 빼고), roster[{ name, pos, rate(%), months }],
 *           prjNo(이은 R&D ERP 과제번호, 못 이으면 ''), prjNm, linkBy('auto' | 'user' | '') }
 *  YAML 글은 설정 페이지가 vendor/yaml(npm yaml 2.9.1 브라우저 빌드)로 풀어 객체로 주고, 여기는 그 객체를 읽는다(readSnapshot). 금액은 원(파일은 예산.단위 — 보통 천원).
 *  history/*.yaml(개정 레지스트리·예산·참여연구원 이력)은 넣지 않는다 — 참조에는 스냅샷(최종본 _rN)이면 된다(kindOf 'history').
 *  같은 과제·차년도에 이미 넣은 판보다 오래된 판(r2 뒤의 r0 = 판 번호 없는 KR_<과제>.yaml)은 넣지 않는다(put 'older').
 *  R&D ERP 과제 잇기(match): 과제명이 같은(띄어쓰기·기호·대소문자 무시) 과제 → 이름이 가장 비슷한 과제(글자 둘씩 겹침 Dice 0.75 이상, 둘째와 0.05 넘게 차이 —
 *   "통합형 PEMFC" ↔ ERP "통합형 100kW급 PEMFC" 같은 것). 설정에서 손으로 고르면 linkBy 'user' 로 남아 다시 넣어도 바뀌지 않는다. 과제 목록은 storage.local.projectList(+ 패널 캐시).
 *  원노트 공유(lib/research-sync.js): KRS WORKSPACE R&D 탭이 올린 「[연구내용] 과제명」 페이지 링크를 설정에 붙여 넣으면 그 기록이 여기로 온다(src = 페이지 id, background.js researchPull).
 *  쓰는 곳: 패널의 연구내용 탭(카드미청구 · 과제집행비율 다음 — 과제를 펼치면 그 계획서, lib/render.js researchSection, state.research) ·
 *   청구 준비 자동 분류(lib/prep-ai.js → help-server/classify.js)에 그 과제의 개발목표·개발내용·연구활동비 세부사용계획을 근거로(refOf) */
const KEY = 'researchPlans';
const UNIT = { 천원: 1000, 원: 1, 백만원: 1e6 };
const SKIP = new Set(['연차', '직접비', '소계', '총액', '합계', '연구개발비총액']);
const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const yearNo = (v) => { const m = String(v == null ? '' : v).match(/(\d{1,2})\s*차/); const n = m ? Number(m[1]) : Number(v); return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 0; };
const amountOf = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v == null ? '' : v).replace(/[,\s원₩]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const won = (v) => `${Math.round(Number(v) || 0).toLocaleString('ko-KR')}원`;
/** "r2" → 2. 판 번호가 없거나 못 읽으면 -1 */
const revNo = (rev) => { const m = str(rev).match(/^r(\d+)$/i); return m ? Number(m[1]) : -1; };
/** 과제명 견주기 키 — 띄어쓰기·기호를 빼고 소문자로 */
const normName = (s) => str(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

/** 무슨 파일인가 — 'snapshot'(meta.과제명) · 'history'(history/ 의 revisions·budget·researchers·objectives) · ''(모르는 파일) */
function kindOf(o) {
  if (!obj(o)) return '';
  if (obj(o.meta) && str(o.meta.과제명)) return 'snapshot';
  if (Array.isArray(o.revisions) || (typeof o.entity === 'string' && Array.isArray(o.items))) return 'history';
  return '';
}

/** 파일 머리 주석(첫 키 앞의 `# …` 줄들)의 첫 줄 꼬리표 — "[1차년도 최초]" · "[재생성 r2]" → 대괄호 안 */
function tagOf(text) {
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (!l.startsWith('#')) break;
    const m = l.replace(/^#\s?/, '').match(/^\[([^\]]+)\]/);
    return m ? m[1].trim() : '';
  }
  return '';
}

/* 그 차년도의 비목별 예산 — 직접비 아래 비목과 간접비(소계·총액 빼고, 0 원 비목 빼고) */
function readBudget(b, n, mul) {
  const row = list(b && b.비목별).find((r) => yearNo(r && r.연차) === n);
  if (!obj(row)) return [];
  const out = [];
  const push = (k, v) => {
    const amt = amountOf(v);
    if (SKIP.has(k) || !amt) return;
    out.push({ item: String(k).replace(/^(직접비|간접비)\//, '').replace(/^연구시설장비비$/, '연구시설·장비비'), plan: Math.round(amt * mul) });
  };
  for (const [k, v] of Object.entries(obj(row.직접비) || {})) push(k, v);
  for (const [k, v] of Object.entries(row)) if (k !== '직접비' && !obj(v) && !Array.isArray(v)) push(k, v);
  return out;
}

/**
 * 스냅샷 객체 → 레코드(그 차년도 몫만). 스냅샷이 아니면 throw.
 * @param {object} o vendor/yaml 로 푼 KR_<과제>.yaml
 * @param {{ text?: string, file?: string, now?: number }} opts text 는 원문(머리 주석의 꼬리표를 읽는다)
 */
function readSnapshot(o, opts) {
  const op = opts || {};
  const m = obj(o && o.meta) || {};
  const name = str(m.과제명);
  if (!name) throw new Error('연구개발계획서 스냅샷이 아닙니다 — meta.과제명 이 없습니다');
  const cover = obj(m.표지) || {}, kr = obj(cover.KR) || {};
  const n = yearNo(m.차년도) || 1;
  const c = obj(o.연구개발내용) || {}, b = obj(o.예산) || {};
  const mul = UNIT[str(b.단위)] || 1000;
  const goal = list(c.목표).find((x) => yearNo(x && x.연차) === n) || {};
  const contents = list(goal.개발내용).map((it) => ({ item: str(it && it.항목), details: list(it && it.세부).map(str).filter(Boolean) })).filter((it) => it.item || it.details.length);
  const perf = [];
  for (const p of list(c.성능목표)) {
    const t = obj(p && p.목표치);
    const hit = t ? Object.entries(t).find(([k]) => yearNo(k) === n) : null;
    const v = hit ? str(hit[1]) : '';
    if (!str(p && p.평가항목) || !v || /^[–—-]$/.test(v)) continue;
    perf.push({ name: str(p.평가항목), target: v, unit: str(p.단위), method: str(p.평가방법) });
  }
  const outs = list(c.주요결과물).find((r) => yearNo(r && r.연차) === n);
  const sched = list(c.수행일정).find((s) => yearNo(s && s.연차) === n);
  const schedule = sched ? {
    months: amountOf(sched.기간개월) || 0,
    items: list(sched.항목).map((a) => ({ name: str(a && a.개발내용), weeks: amountOf(a && a.기간주) || 0, from: amountOf(a && a.착수월) || 0, to: amountOf(a && a.종료월) || 0 })).filter((a) => a.name),
  } : null;
  const spend = list(b.세부사용계획).filter((s) => yearNo(s && s.연차) === n && str(s.명칭)).map((s) => ({
    name: str(s.명칭), kind: str(s.구분), method: str(s.방식), qty: amountOf(s.수량), amount: amountOf(s.금액) == null ? null : Math.round(amountOf(s.금액) * mul), period: str(s.사용기간),
  }));
  const ry = list(b.참여연구자인건비).find((r) => yearNo(r && r.연차) === n);
  const roster = list(ry && ry.참여자).filter((p) => str(p && p.성명)).map((p) => ({ name: str(p.성명), pos: str(p.직위), rate: amountOf(p.계상률), months: amountOf(p.참여기간_개월) }));
  const biz = obj(cover.사업명) ? str(cover.사업명.세부) : str(cover.사업명);
  const main = str((obj(cover.주관연구개발기관) || {}).기관명 || m.주관연구개발기관);
  return {
    id: `${normName(name)}#${n}`, name, code: str(m.연구개발과제번호 || cover.연구개발과제번호), n, rev: str(m.rev), tag: tagOf(op.text),
    file: str(op.file), at: op.now || Date.now(), agree: str(m.협약일), period: str(m.기간),
    role: str(kr.역할), lead: str(kr.책임자 || m.KR연구책임자 || m.연구책임자),
    note: [str(cover.중앙행정기관), biz, main ? `주관 ${main}` : ''].filter(Boolean).join(' · '),
    goals: list(goal.개발목표).map(str).filter(Boolean), contents, perf,
    outputs: list(outs && outs.결과물).map(str).filter(Boolean), schedule, spend, budget: readBudget(b, n, mul), roster,
    prjNo: '', prjNm: '', linkBy: '',
  };
}

/* 글자 둘씩 겹침(Dice) — 0~1 */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let hit = 0;
  for (const [k, v] of A) hit += Math.min(v, B.get(k) || 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * hit) / total;
}

/** 과제 목록에서 같은 과제번호는 하나만 (projectList 와 패널 캐시를 합쳐 넘기므로) */
function uniq(projects) {
  const seen = new Map();
  for (const p of list(projects)) if (p && p.prjNo && !seen.has(p.prjNo)) seen.set(p.prjNo, p);
  return Array.from(seen.values());
}

/** 계획서 과제명 → R&D ERP 과제 { prjNo, prjNm, score } (못 찾으면 null) */
function match(name, projects) {
  const k = normName(name);
  if (!k) return null;
  const ps = uniq(projects).filter((p) => p.prjNm);
  const exact = ps.find((p) => normName(p.prjNm) === k);
  if (exact) return { prjNo: exact.prjNo, prjNm: exact.prjNm, score: 1 };
  const scored = ps.map((p) => ({ p, s: dice(k, normName(p.prjNm)) })).sort((a, b) => b.s - a.s);
  const [a, b] = scored;
  if (a && a.s >= 0.75 && (!b || a.s - b.s > 0.05)) return { prjNo: a.p.prjNo, prjNm: a.p.prjNm, score: Math.round(a.s * 100) / 100 };
  return null;
}

/** 손으로 고르지 않은 레코드를 과제 목록에 다시 잇는다. 못 찾으면 있던 연결을 둔다(목록이 덜 받아졌을 수 있음). 바뀐 수를 돌려준다 */
function link(map, projects) {
  let changed = 0;
  const ps = uniq(projects);
  if (!ps.length) return 0;
  for (const rec of Object.values(map || {})) {
    if (!rec || rec.linkBy === 'user') continue;
    const m = match(rec.name, ps);
    if (m && (m.prjNo !== rec.prjNo || m.prjNm !== rec.prjNm || rec.linkBy !== 'auto')) { Object.assign(rec, { prjNo: m.prjNo, prjNm: m.prjNm, linkBy: 'auto' }); changed++; }
  }
  return changed;
}

/**
 * 레코드를 넣는다 — 같은 id(과제·차년도)에 더 새로운 판이 이미 있으면 넣지 않는다.
 * 손으로 고른 연결(linkBy 'user')은 이어받는다. 돌려주는 것: { state: 'added' | 'updated' | 'older', prev }
 */
function put(map, rec) {
  const prev = map[rec.id] || null;
  if (prev && revNo(rec.rev) >= 0 && revNo(rec.rev) < revNo(prev.rev)) return { state: 'older', prev };
  const keep = prev && prev.linkBy === 'user' ? { prjNo: prev.prjNo, prjNm: prev.prjNm, linkBy: 'user' } : prev && prev.prjNo ? { prjNo: prev.prjNo, prjNm: prev.prjNm, linkBy: prev.linkBy } : {};
  map[rec.id] = Object.assign({}, rec, keep);
  return { state: prev ? 'updated' : 'added', prev };
}

/** 과제(과제번호 · R&D ERP 연차)에 쓸 레코드 — 연차와 같은 차년도 → 그보다 앞선 가장 늦은 차년도 → 가장 늦은 차년도. 없으면 null */
function forProject(map, prjNo, anl) {
  if (!prjNo || !map) return null;
  const recs = Object.values(map).filter((r) => r && r.prjNo === prjNo).sort((a, b) => b.n - a.n);
  if (!recs.length) return null;
  const n = Number(anl) || 0;
  return (n && (recs.find((r) => r.n === n) || recs.find((r) => r.n < n))) || recs[0];
}

/** 같은 과제에 이어진 레코드 수 (패널 툴팁 — "다른 차년도 1개") */
const countFor = (map, prjNo) => Object.values(map || {}).filter((r) => r && r.prjNo === prjNo).length;

/** 한 줄 요약 — "1차년도 r2 · 목표 2 · 연구활동비 계획 8건" */
function summary(rec) {
  if (!rec) return '';
  return [`${rec.n}차년도${rec.rev ? ` ${rec.rev}` : ''}`, rec.goals.length ? `목표 ${rec.goals.length}` : '', rec.spend.length ? `연구활동비 계획 ${rec.spend.length}건` : ''].filter(Boolean).join(' · ');
}

const monthsOf = (a) => (a.from && a.to ? `${a.from}~${a.to}월` : a.from ? `${a.from}월~` : '');
/** 성능목표 목표치 — 숫자만 적힌 것에만 단위를 붙인다 ("1" 건 → "1 건", "2초 이내" 는 그대로) */
const perfTarget = (p) => `${p.target}${p.unit && /^[\d.,]+$/.test(p.target) ? ` ${p.unit}` : ''}`;
/** 머리 한 줄 — "RS-… · 기간 … · 협약 … · KR 공동 · KR 책임자 …" */
const infoOf = (rec) => [rec.code, rec.period ? `기간 ${rec.period}` : '', rec.agree ? `협약 ${rec.agree}` : '', rec.role ? `KR ${rec.role}` : '', rec.lead ? `KR 책임자 ${rec.lead}` : ''].filter(Boolean).join(' · ');
/** 레코드 → 절 [{ title, lines }] — 빈 절은 빼고. 글(textOf)과 원노트 표(lib/research-sync.js blockHtml)가 같이 쓴다 */
function sections(rec) {
  if (!rec) return [];
  const out = [];
  const add = (title, lines) => { if (lines.length) out.push({ title, lines }); };
  const bits = (xs) => xs.filter(Boolean).join(' · ');
  add('개발목표', rec.goals.map((x, i) => `${i + 1}. ${x}`));
  add('개발내용', [].concat(...rec.contents.map((c) => (c.item ? [`- ${c.item}`] : []).concat(c.details.map((d) => `  · ${d}`)))));
  add('성능목표', rec.perf.map((p) => `- ${p.name}: ${perfTarget(p)}${p.method ? ` (${p.method})` : ''}`));
  if (!sameAsContents(rec)) add('주요결과물', rec.outputs.map((x) => `- ${x}`));
  if (rec.schedule) add(`수행일정${rec.schedule.months ? ` (${rec.schedule.months}개월)` : ''}`, rec.schedule.items.map((a) => `- ${a.name}${a.weeks ? ` ${a.weeks}주` : ''}${monthsOf(a) ? ` (${monthsOf(a)})` : ''}`));
  if (rec.spend.length) add('연구활동비 세부사용계획', rec.spend.map((s) => `- ${s.name}${bits([s.kind, s.method]) ? ` (${bits([s.kind, s.method])})` : ''}${s.qty != null ? ` × ${s.qty}` : ''}${s.amount != null ? ` · ${won(s.amount)}` : ''}${s.period ? ` · ${s.period}` : ''}`).concat([`  계 ${won(spendTotal(rec))}`]));
  add('비목별 예산', rec.budget.map((x) => `- ${x.item} ${won(x.plan)}`));
  add('참여연구자', rec.roster.map((p) => { const b = bits([p.pos, p.rate != null ? `${p.rate}%` : '', p.months ? `${p.months}개월` : '']); return `- ${p.name}${b ? ` — ${b}` : ''}`; }));
  return out;
}
/** 레코드 → 글 (설정 페이지 미리보기 · 패널 복사). 절 제목은 ■, 항목은 - · */
function textOf(rec) {
  if (!rec) return '';
  const L = [`${rec.name} — ${rec.n}차년도${rec.rev ? ` (${rec.rev})` : ''}`];
  if (infoOf(rec)) L.push(infoOf(rec));
  if (rec.note) L.push(rec.note);
  for (const s of sections(rec)) L.push('', `■ ${s.title}`, ...s.lines);
  return L.join('\n');
}
/** 주요결과물이 개발내용 항목과 같은 글이면(원문에 결과물 표가 없어 갈음한 것) 따로 보이지 않는다 */
function sameAsContents(rec) {
  const items = rec.contents.map((c) => normName(c.item));
  return rec.outputs.length > 0 && rec.outputs.every((x) => items.includes(normName(x)));
}
const spendTotal = (rec) => (rec && rec.spend || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);

/** 청구 준비 자동 분류에 넘길 근거 (help-server/classify.js clean 이 다시 자르고 다듬는다). 레코드가 없으면 null */
function refOf(rec) {
  if (!rec) return null;
  return {
    year: `${rec.n}차년도`, goals: rec.goals.slice(0, 8), contents: rec.contents.slice(0, 10).map((c) => c.item).filter(Boolean),
    spend: rec.spend.slice(0, 40).map((s) => ({ name: s.name, kind: s.kind, method: s.method, amount: s.amount })),
  };
}

async function load() {
  try { const m = (await chrome.storage.local.get(KEY))[KEY]; return obj(m) || {}; } catch (e) { return {}; }
}
async function save(map) { await chrome.storage.local.set({ [KEY]: map || {} }); }

/* 패널(eClass 콘텐츠스크립트 · 팝업): state.research 를 채우고, 설정 페이지에서 넣고 빼면 다시 그린다. 펼친 블록의 "복사"(data-act=rs-copy)는 그 글을 클립보드로 */
function bind(host, state, draw) {
  if (!state.research) state.research = {};
  host.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act="rs-copy"]');
    if (!btn) return;
    ev.preventDefault();
    const rec = (state.research || {})[btn.dataset.id];
    if (!rec) return;
    const done = (t) => { btn.textContent = t; setTimeout(() => { btn.textContent = '복사'; }, 1500); };
    try { navigator.clipboard.writeText(textOf(rec)).then(() => done('복사됨'), () => done('복사 실패')); } catch (e) { done('복사 실패'); }
  });
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      try { if (area === 'local' && ch[KEY]) { state.research = obj(ch[KEY].newValue) || {}; draw(); } } catch (e) {}
    });
  } catch (e) {}
  // 원노트 링크로 이어 둔 연구내용 페이지(KRS WORKSPACE 가 올린 것)를 패널을 열 때 다시 받는다 — 백그라운드가 10분 안이면 건너뛰고, 이어 둔 페이지가 없으면 아무것도 안 함 (background.js researchPull)
  try { const p = chrome.runtime.sendMessage({ type: 'researchPull', reason: 'load' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}

const api = { KEY, kindOf, readSnapshot, normName, revNo, dice, uniq, match, link, put, forProject, countFor, summary, infoOf, sections, textOf, sameAsContents, spendTotal, perfTarget, monthsOf, refOf, load, save, bind };
export default api;
