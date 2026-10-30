// 설정 → 일반의 "행위 명세" 칸 — actions/spec/<갈래>/<종류>.yaml 원본을 갈래(근태·공문 …)로 나눠 읽기만 한다. 사용자 지정(2026-10-16):
// "yaml 파일을 저 설정에서 보고 싶은데", "그냥 일반에서 볼 수 있었으면", "근태 공문 이런 식으로 구분되면".
// 확장은 제 폴더를 훑지 못하니 목록은 생성물 ACTIONS(actions/spec.js — node tools/gen-actions.mjs)에서 만든다. 고치는 곳은 저장소의 YAML 이고
// 패널이 쓰는 것은 그 생성물이라 여기서는 고치지 않는다.
//
// 순수 함수다 — DOM 도 fetch 도 만지지 않는다. 그리는 쪽(sidepanel.js pickSpecDomain·pickSpecFile)이 갈래를 받아 단추를 그리고 고른 파일을 읽는다.

export const SPEC_DIR = 'actions/spec';

/** 갈래 차례 — 머리의 탭 줄(근태·공문·R&D·메일·회의실·차량)을 따르되 여비계산서는 근태 옆, 탭이 없는 홈 카드·회람은 뒤. 모르는 갈래는 맨 끝(이름 차례). */
export const DOMAIN_ORDER = ['attend', 'trip', 'gongmun', 'board', 'dwr', 'rnd', 'mail', 'room', 'car', 'home', 'circulate'];

/**
 * @param {{ domains?: object, actions?: object }} spec ACTIONS(actions/spec.js)
 * @returns {{ domain: string, title: string, files: { key: string, label: string, path: string, status: string }[] }[]}
 *   files 의 첫 줄은 갈래 공통(_domain.yaml — key '_domain', 이름 `공통`), 나머지는 _domain.yaml 의 kinds 차례. status 는 live|planned(공통은 '').
 */
export function specGroups(spec) {
  const domains = spec?.domains || {};
  const rank = (d) => { const i = DOMAIN_ORDER.indexOf(d); return i < 0 ? DOMAIN_ORDER.length : i; };
  return Object.keys(domains)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((domain) => {
      const files = [{ key: '_domain', label: '공통', path: `${SPEC_DIR}/${domain}/_domain.yaml`, status: '' }];
      for (const kind of domains[domain].kinds || []) {
        const a = spec.actions?.[`${domain}.${kind}`] || {};
        files.push({ key: kind, label: a.title || kind, path: `${SPEC_DIR}/${domain}/${kind}.yaml`, status: a.status || 'live' });
      }
      return { domain, title: domains[domain].title || domain, files };
    });
}

/* ------------------------------------------------------------ YAML 칠하기 */
// 원본을 편집기처럼 보이게(2026-10-16 사용자 지정: "yaml 포맷 형태로 안보이네") 줄마다 조각으로 나눈다 — 보기만을 위한 가벼운 구분이지 파서가 아니다.
// 조각의 c: '' 그대로 · key 키 · punct `:`·`-`·`{}[],`·블록 기호 · str 따옴표 글·블록 글 · val 따옴표 없는 값 · num 수 · bool true/false/null · cmt 주석.
// ind 는 줄이 접힐 때 이어지는 줄을 맞출 자리(앞 공백 + 목록 기호 `- `) — 그리는 쪽이 매단 들여쓰기(hanging indent)로 쓴다.
// 조각을 이으면 원래 줄과 글자 하나 다르지 않다(복사해도 원본 그대로).

const FLOW = '{}[],';

/** 따옴표 밖의 ` #` 부터가 주석이다. 따옴표는 값의 맨 앞이나 공백·여는 괄호·쉼표 뒤에서만 연다(한글 글 속의 ' 는 그냥 글자). */
function splitComment(s) {
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = ''; continue; }
    if ((ch === "'" || ch === '"') && (i === 0 || /[\s[{,]/.test(s[i - 1]))) { q = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return [s.slice(0, i), s.slice(i)];
  }
  return [s, ''];
}

/** 값 하나 — 앞뒤 공백은 그대로 두고 가운데만 갈래를 붙인다. */
function scalar(s) {
  const m = s.match(/^(\s*)(.*?)(\s*)$/s);
  const [, lead, core, tail] = m;
  const parts = [];
  if (lead) parts.push({ t: lead, c: '' });
  if (core) {
    const c = /^(['"]).*\1$/s.test(core) ? 'str'
      : /^[-+]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?$/.test(core) ? 'num'
        : /^(true|false|null|~)$/i.test(core) ? 'bool'
          : /^[|>][-+0-9]*$/.test(core) ? 'punct'
            : 'val';
    parts.push({ t: core, c });
  }
  if (tail) parts.push({ t: tail, c: '' });
  return parts;
}

/** 흐름 꼴(`{ a: 1, b: [x, y] }`) — 괄호·쉼표는 punct, `키:` 는 key, 나머지는 값. 따옴표 안의 쉼표·괄호는 글이다. */
function flow(s) {
  const parts = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (FLOW.includes(ch)) { parts.push({ t: ch, c: 'punct' }); i++; continue; }
    let j = i;
    while (j < s.length && !FLOW.includes(s[j])) {
      if ((s[j] === "'" || s[j] === '"') && (j === i || /[\s:]/.test(s[j - 1]))) {
        const end = s.indexOf(s[j], j + 1);
        j = end < 0 ? s.length : end + 1;
      } else j++;
    }
    const tok = s.slice(i, j);
    const k = tok.match(/^(\s*)([^\s'"][^:]*?|'[^']*'|"[^"]*"):(?=\s|$)/);
    if (k) {
      if (k[1]) parts.push({ t: k[1], c: '' });
      parts.push({ t: k[2], c: 'key' }, { t: ':', c: 'punct' }, ...scalar(tok.slice(k[0].length)));
    } else parts.push(...scalar(tok));
    i = j;
  }
  return parts;
}

/** 값 자리(키 뒤나 목록 기호 뒤) — 흐름 꼴이면 흐름으로, 아니면 값 하나. */
function value(s) {
  return /^\s*[[{]/.test(s) ? flow(s) : scalar(s);
}

/**
 * @param {string} text YAML 원본
 * @returns {{ ind: number, parts: { t: string, c: string }[] }[]} 줄마다. 빈 줄은 parts 가 비어 있다.
 */
export function yamlLines(text) {
  const out = [];
  let block = -1;   // 블록 글(`key: |`·`>-` …)을 연 줄의 들여쓰기 — 그보다 깊은 줄과 빈 줄은 글 그대로(str)
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  for (const raw of lines) {
    const ind = raw.match(/^ */)[0].length;
    const body = raw.slice(ind);
    const parts = ind ? [{ t: raw.slice(0, ind), c: '' }] : [];
    if (block >= 0 && (!body || ind > block)) {
      if (body) parts.push({ t: body, c: 'str' });
      out.push({ ind, parts: body ? parts : [] });
      continue;
    }
    block = -1;
    if (!body) { out.push({ ind: 0, parts: [] }); continue; }
    let rest = body;
    let hang = ind;
    let m;
    while ((m = rest.match(/^-(?:[ \t]+|$)/))) {   // 목록 기호 — `- - x` 처럼 겹칠 수 있다
      parts.push({ t: m[0], c: 'punct' });
      hang += m[0].length;
      rest = rest.slice(m[0].length);
    }
    if (rest.startsWith('#')) {
      parts.push({ t: rest, c: 'cmt' });
    } else if (rest === '---' || rest === '...') {
      parts.push({ t: rest, c: 'punct' });
    } else {
      const [val, cmt] = splitComment(rest);
      const k = val.match(/^('[^']*'|"[^"]*"|[^\s#'"{}[\],][^:#]*?)(\s*):(?=\s|$)/);
      if (k) {
        parts.push({ t: k[1], c: 'key' });
        if (k[2]) parts.push({ t: k[2], c: '' });
        parts.push({ t: ':', c: 'punct' });
        const v = val.slice(k[0].length);
        if (/^\s*[|>][-+0-9]*\s*$/.test(v)) block = ind;
        parts.push(...value(v));
      } else {
        parts.push(...value(val));
      }
      if (cmt) parts.push({ t: cmt, c: 'cmt' });
    }
    out.push({ ind: hang, parts });
  }
  return out;
}
