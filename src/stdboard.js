// e-Class 「Standard Documents」 게시판(46V4)에 국제표준 PDF 하나를 글 하나로 올리는 길 — 공문 탭의 국제표준 업로드 칸(stdbox.js)이
// board.standard 기록으로 부른다(actions/runners/board.js, 2026-10-30 사용자 지정: "pdf 표준 주면 업로드 해주고 … zip 이면 풀어서 업로드 하고").
//
// 쓰기 화면(BoardNew/Write/mode=new/46V4)이 하는 차례 그대로다 — 2026-10-30 그 화면의 소스와, 화면으로 표준 13건을 올리며 CDP 로 본 요청에서 확인했다:
//
//   1) GET  BoardNew/Write/mode%3Dnew/46V4?sMainCate=107&sSubCate=<분류>   폼 myForm 의 칸(userid·empid·deptcode·email …)과 쓰기 권한(authResult)
//   2) POST BoardNew/DraftFileUp?pType=SEND&bid=46V4&use=dext   multipart — 첨부 컴포넌트 DEXTUploadX5 의 칸(memo.js 의 쪽지 첨부와 같다)
//                               → "SEND:<원래 이름>|<저장 이름>|<크기>|pdf:" (같은 이름이 서버 임시 폴더에 남아 있으면 저장 이름에 (1) 이 붙는다)
//   3) POST BoardNew/TempWrite   urlencoded — 폼 칸 그대로에 catecode·writershow(D 부서 · P 이름)·lan K·subject·msgbody(<p>제목</p>)·
//                               fileStr·hdn_upload_info(2 의 답에서 "SEND:" 를 뗀 것) — 화면의 onDX5UploadCompleted 가 하는 것
//   4) GET  BoardNew/List/46V4?sTitle=true&sText=<번호>   새 글을 찾아 번호를 확인한다
//
// 같은 표준이 이미 있는지도 4 와 같은 찾기로 먼저 본다 — 표준번호를 글자 묶음·숫자 묶음으로 나눠 견준다('IEC 61660-2:1997' = 'IEC61660-2_1997').
// 게시판의 관례(2026-10-23 수소전기추진연구팀이 올린 글들): 제목·본문은 '표준번호 - 표준명', 분류는 표준(standard) › ISO·IEC·EN·KS·기타, 작성자는 부서 표시.
// 사이트의 답은 단계마다 확인하고, 기대한 답이 아니면 그 자리에서 멈춘다. 재시도하지 않는다 — 2 뒤에 멈추면 서버 임시 폴더에 파일만 남고 글은 없다.

import { ORIGIN } from './config.js';
import { AuthError, siteFetch } from './net.js';
import { dextAuthKey } from './memo.js';

/** 게시판 번호와 분류 — 표준(standard) 107 아래 ISO 108 · IEC 109 · EN 110 · KS 111 · 기타 112(쓰기 화면의 subCateSelect). */
export const STD_BOARD = '46V4';
const MAIN_CATE = 107;
export const STD_CATEGORY = { ISO: 108, IEC: 109, EN: 110, KS: 111, ETC: 112 };
/** 칸에 보일 분류 이름(ETC 는 게시판의 '기타'). */
export const STD_CATEGORY_LABEL = { ISO: 'ISO', IEC: 'IEC', EN: 'EN', KS: 'KS', ETC: '기타' };

const BASE = `${ORIGIN}/eClassVer4/BoardNew`;
/** 게시판 목록 — 칸의 머리 링크. */
export const STD_LIST_URL = `${ORIGIN}/eClassVer4/Common/Default?title=Standard%20Documents&menu=%2FeClassVer4%2FBoardNew%2FList%2F${STD_BOARD}&menuID=MTI00037&newWindow=False&PmenuID=MTI00001`;
const DEXT_CONFIG_URL = `${ORIGIN}/intra/intranet/DEXT_X5_V4_3/dextuploadx5-configuration.js`;
/** 쓰기 화면이 첨부 컴포넌트에 붙인 이름(dx5.create 의 id). */
const DEXT_CONTROL = 'dext5';
/** 파일 올리기는 큰 PDF(12MB 넘는 것도 있다)라 보통 요청보다 길게 기다린다. */
const UPLOAD_TIMEOUT_MS = 180_000;

export const stdWriteUrl = (category) => `${BASE}/Write/mode%3Dnew/${STD_BOARD}?sMainCate=${MAIN_CATE}&sSubCate=${STD_CATEGORY[category] || STD_CATEGORY.ETC}`;
export const stdPostUrl = (id) => `${BASE}/Content?bid=${STD_BOARD}&id=${encodeURIComponent(id)}`;
export const stdSearchUrl = (text) => `${BASE}/List/${STD_BOARD}?sTitle=true&sText=${encodeURIComponent(text)}&pagesize=50&nowpage=1`;

const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 넣으세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in/i.test(html || '');
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

/* ------------------------------------------------------------ 표준번호·표준명 */

const squash = (s) => String(s ?? '').replace(/[ \s]+/g, ' ').trim();
/** 긴 줄표(–·—)는 ' - ' 로 — 오늘 올린 글들(KSSN 의 표준명)의 꼴. */
const dashes = (s) => squash(String(s ?? '').replace(/\s*[–—‒]\s*/g, ' - '));

/** 표준을 낸 곳 → 게시판 분류. IEC/IEEE 공동은 IEC(게시판에 그렇게 있다), KS 는 안에 IEC 가 있어도 KS. */
export function stdCategory(designation) {
  const s = squash(designation).toUpperCase().replace(/^CEI\s*\/\s*/, '');
  if (/^KS\b|^KS\s?[A-Z]\b/.test(s)) return 'KS';
  if (/^ISO/.test(s)) return 'ISO';
  if (/^IEC/.test(s)) return 'IEC';
  if (/^(?:(?:BS|DIN|NF|SS)\s+)?EN\b/.test(s)) return 'EN';
  return 'ETC';
}

/** 파일 이름 끝의 언어 표시(EN·FR·EN_FR …)와 형식 표시. */
const LANG = /^(EN|FR|DE|ES|RU|ZH|JA|KO|AR|ENFR|EN-FR|BIL|PDF)$/i;

/**
 * 파일 이름에서 표준번호 — KSSN 이 주는 꼴(IEC60071-11_2022_EN_FR · IECTR63179_2026_EN · IEEE2800.2-2026_EN)과 게시판에 있던 꼴
 * (iso-20421-2-2017 · ISO_TS18683_2021_EN · IEC_IEEE80005-2_2016_EN_FR · IEC60079-10-1_2020CMV_COR1_2021_EN). 모르면 빈 글.
 */
export function stdFromName(fileName) {
  const base = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]+$/, '');
  const ieee = base.match(/^IEEE[\s_-]*(?:Std[\s_-]*)?(\d+(?:\.\d+)*)[-_\s]((?:19|20)\d\d)(?![\d])/i);
  if (ieee) return `IEEE ${ieee[1]}-${ieee[2]}`;
  const m = base.match(/^(IEC|ISO|EN|KS)(?:[\s_/-]?(IEEE|IEC|ISO|ASTM))?[\s_-]?(TR|TS|PAS|GUIDE)?[\s_-]?([A-Z]?\d+(?:[-.]\d+)*)(.*)$/i);
  if (!m) return '';
  const org = m[1].toUpperCase() + (m[2] ? `/${m[2].toUpperCase()}` : '');
  let num = m[4].toUpperCase();
  let rest = m[5] || '';
  // 연도가 번호에 붙은 꼴(iso-20421-2-2017) — 맨 끝의 -19xx·-20xx 를 연도로 뗀다(번호가 남을 때만).
  let year = '';
  const tail = num.match(/^(.+?)[-.]((?:19|20)\d\d)$/);
  if (tail) [, num, year] = tail;
  const parts = rest.split(/[\s_]+/).filter(Boolean);
  if (!year && /^(?:19|20)\d\d/.test(parts[0] || '')) {
    const y = parts.shift();
    year = y.slice(0, 4);
    if (y.length > 4) parts.unshift(y.slice(4));                  // 2020CMV → 2020 · CMV
  }
  const extra = parts.filter((p) => !LANG.test(p));
  const type = m[3] ? ` ${m[3].toUpperCase()}` : '';
  return squash(`${org}${type} ${num}${year ? `:${year}` : ''} ${extra.join(' ')}`);
}

/** 표지의 참조 번호 줄(IEC TR 63179:2026-01(en) · CEI/IEC 61660-1: 1997 · ISO 20421-2:2017(E)) → 표준번호. */
function designationFromCover(lines) {
  for (const line of lines) {
    const m = line.match(/^(?:CEI\s*\/\s*)?(IEC|ISO)(?:\s*\/\s*(IEEE|IEC|ISO))?\s+(?:(TR|TS|PAS)\s+)?(\d+(?:[-.]\d+)*)\s*:\s*((?:19|20)\d\d)\b/i);
    if (m) return `${m[1].toUpperCase()}${m[2] ? `/${m[2].toUpperCase()}` : ''}${m[3] ? ` ${m[3].toUpperCase()}` : ''} ${m[4]}:${m[5]}`;
  }
  return '';
}

/** 메타데이터 제목 'IEEE Std 2004™-2025, IEEE Recommended …' → 표준번호와 표준명. 표준명이 아닌 제목(Microsoft Word - …)은 버린다. */
function fromMeta(meta) {
  const t = squash(meta);
  if (!t || /^(microsoft|untitled|document\b|title\b)|\.(docx?|pdf|indd)$/i.test(t)) return { designation: '', title: '' };
  const ieee = t.match(/^IEEE\s+(?:Std\s+)?(\d+(?:\.\d+)*)\D{0,3}?[-–]\s?((?:19|20)\d\d)\s*[,:]?\s*(.*)$/i);
  if (ieee) return { designation: `IEEE ${ieee[1]}-${ieee[2]}`, title: ieee[3] };
  // 표준번호뿐인 제목(IEC TS 63336:2024)은 표준명이 아니다. 표준번호로 시작하는 제목은 그 번호를 뗀다.
  if (/^(?:CEI\/)?(IEC|ISO|EN|KS)\b[\s\w./:-]*\d{4}\S*$/i.test(t)) return { designation: '', title: '' };
  const rest = t.replace(/^(?:CEI\/)?(?:IEC|ISO|EN|KS)(?:\/[A-Z]+)?\s*(?:TR|TS|PAS)?\s*[\d.:/-]+(?:\s*\([\w-]+\))?\s*[,:–-]?\s*/i, '');
  return { designation: '', title: /[a-z]{3}/.test(rest) && rest.includes(' ') ? rest : '' };
}

/** 프랑스어 줄 — 옛 IEC 표지는 프랑스어 제목이 먼저, 요즘 표지·ISO 는 영어 다음에 온다. */
const FRENCH = /[àâçéèêëîïôûùüÿœæ]|(?:^|\s)(?:de|des|du|la|le|les|et|dans|pour|aux|sur)(?=\s|$)|(?:^|\s)[ld]'|^Partie\b/i;
/** 표지 머리의 줄 — 종류 말만 있는 줄(INTERNATIONAL STANDARD · TECHNICAL REPORT …)·번호 줄(IEC TR 63179 · 61660-1)·판(Edition 1.0 2024-07 · First edition). */
const HEAD = new RegExp(`^(?:${[
  '(?:(?:INTERNATIONAL|STANDARD|NORME|INTERNATIONALE|TECHNICAL|TECHNIQUE|REPORT|RAPPORT|SPECIFICATION|SP[EÉ]CIFICATION|PUBLICLY|AVAILABLE|GUIDE|CEI|IEC|ISO|IEEE|BASIC|HORIZONTAL|GROUP|SAFETY|PUBLICATION)\\s*)+',
  '(?:CEI\\s*\\/\\s*)?[A-Z]{2,5}(?:\\s*\\/\\s*[A-Z]{2,5})?\\s*(?:TR|TS|PAS)?\\s*\\d[\\d\\s.-]*',
  '\\d+(?:[-.]\\d+)*',
  'Edition\\b.*', '.*\\bedition', 'Premi[eè]re\\s+[ée]dition', 'Deuxi[eè]me\\s+[ée]dition', 'Troisi[eè]me\\s+[ée]dition',
  '\\d{4}-\\d{2}(?:-\\d{2})?', '®', 'colour\\s*inside', 'Reference number', 'Num[ée]ro de r[ée]f[ée]rence',
].join('|')})$`, 'i');
/** 표준명이 끝나는 줄 — 참조 번호·ICS·ISBN·저작권. */
const STOP = /^(?:(?:CEI\s*\/\s*)?(?:IEC|ISO)\b.*\d{4}|ICS\b|ISBN\b|©|Copyright|Reference number|Num[ée]ro de r[ée]f[ée]rence|THIS PUBLICATION IS COPYRIGHT|colour\s*inside)/i;

/** 표지 글에서 영문 표준명 — 머리 줄들 다음, 프랑스어 줄은 건너거나(앞에 있을 때) 거기서 멈추고(뒤에 있을 때), 참조 번호 줄에서 멈춘다. */
function titleFromCover(lines) {
  let i = 0;
  while (i < lines.length && HEAD.test(lines[i])) i++;
  while (i < lines.length && FRENCH.test(lines[i]) && !STOP.test(lines[i])) i++;   // 옛 표지 — 프랑스어 제목이 먼저
  const out = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (STOP.test(line) || FRENCH.test(line) || HEAD.test(line)) break;
    out.push(line);
  }
  return out.join(' ');
}

/** 표준명이 그럴듯한가 — 글자가 있고, 너무 짧거나 길지 않고, 표지 머리 말이 아니다. */
const titleOk = (t) => t.length >= 4 && t.length <= 300 && /[A-Za-z]{3}/.test(t) && !HEAD.test(t);

/**
 * PDF 의 메타데이터 제목·첫 쪽 글·파일 이름에서 표준번호·표준명·분류를 읽는다(규칙 — LLM 없이).
 *   표준번호: 파일 이름(KSSN 꼴 — 정오표·개정 표시까지 담긴다) → 메타데이터(IEEE Std …) → 표지의 참조 번호 줄
 *   표준명:   메타데이터 제목(IEEE 는 늘 있다) → 표지의 머리 줄 다음 영문 줄(IEC·ISO)
 * 못 읽은 것은 빈 글이다 — 칸이 그 줄에 적어 달라고 한다.
 * @param {{ name: string, meta?: string, text?: string }} pdf  meta 는 PDF 정보의 Title, text 는 첫 쪽 글(줄 바꿈 그대로)
 * @returns {{ designation: string, title: string, category: string }}
 */
export function stdFromPdf({ name = '', meta = '', text = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(squash).filter(Boolean);
  const fromM = fromMeta(meta);
  const designation = stdFromName(name) || fromM.designation || designationFromCover(lines);
  let title = dashes(fromM.title);
  if (!titleOk(title)) title = dashes(titleFromCover(lines));
  if (!titleOk(title)) title = '';
  return { designation, title: title.replace(/\s+([:,])/g, '$1'), category: stdCategory(designation) };
}

/** 글 제목(=본문) — '표준번호 - 표준명'. */
export const stdSubject = (designation, title) => squash(`${squash(designation)}${squash(title) ? ` - ${squash(title)}` : ''}`);

/** 견주는 열쇠 — 글자 묶음(붙은 것은 하나로)·숫자 묶음의 줄. 'IEC TR 63179:2026' = 'IECTR63179_2026'. */
export function stdTokens(s) {
  const raw = squash(s).toUpperCase().replace(/^CEI\s*\/\s*/, '').match(/[A-Z]+|\d+/g) || [];
  const out = [];
  for (const t of raw) {
    const letters = /^[A-Z]/.test(t);
    if (letters && out.length && /^[A-Z]/.test(out[out.length - 1])) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/** 글 제목이 그 표준번호로 시작하는가(분류 머리 [IEC] 는 뗀 제목). */
export function sameStandard(subject, designation) {
  const want = stdTokens(designation);
  const got = stdTokens(subject);
  return want.length > 1 && want.every((t, i) => got[i] === t);
}

/* ------------------------------------------------------------ 게시판 읽기 */

const decodeEntities = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

/** 첨부 링크(FileDown/46V4|글|파일|<이름 base64>|pdf|크기|n)의 이름 — base64 의 = 는 _, + 는 - 로 적혀 있다. */
function fileOf(href) {
  const p = decodeEntities(href).split('|');
  if (p.length < 6) return null;
  let name = '';
  try {
    const bin = atob(p[3].replace(/_/g, '=').replace(/-/g, '+'));
    name = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { /* 이름 없이 */ }
  return { name, size: Number(p[5]) || 0 };
}

/**
 * 목록 화면의 글 줄 — 번호(id — 글 보기 링크의 것)·제목(분류 머리 [IEC] 와 NEW 표시를 뗀 것)·분류·첨부.
 * @returns {{ id: string, subject: string, category: string, file: {name: string, size: number}|null }[]}
 */
export function listRows(html) {
  const rows = [];
  for (const [tr] of String(html || '').matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const a = tr.match(/<a\s+href=['"]([^'"]*\/BoardNew\/Content\?[^'"]*)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const id = (decodeEntities(a[1]).match(/[?&]id=(\d+)/) || [])[1];
    if (!id) continue;
    let text = squash(decodeEntities(a[2].replace(/<span[^>]*class=["'][^"']*badge[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, '')));
    const cat = text.match(/^\[([^\]]{1,10})\]\s*/);
    if (cat) text = text.slice(cat[0].length);
    const f = tr.match(/href=['"]([^'"]*\/BoardNew\/FileDown\/[^'"]+)['"]/i);
    rows.push({ id, subject: text, category: cat ? cat[1] : '', file: f ? fileOf(f[1]) : null });
  }
  return rows;
}

/** 찾기 말 — 표준번호의 첫 숫자 묶음(61660 · 2800 · 63179). 게시판 찾기는 제목에 그 말이 든 글을 준다. */
const searchWord = (designation) => (squash(designation).match(/\d{3,}/) || [squash(designation)])[0];

/**
 * 게시판에서 그 표준번호로 시작하는 글을 찾는다(읽기만). 새 글이 위다.
 * @returns {Promise<{ id: string, subject: string, category: string, file: object|null }[]>}
 */
export async function stdFind(designation) {
  const page = await siteFetch(stdSearchUrl(searchWord(designation)));
  if (looksLogin(page.html)) throw new AuthError(LOGIN);
  return listRows(page.html).filter((r) => sameStandard(r.subject, designation));
}

/* ------------------------------------------------------------ 쓰기 */

const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
};

/** 쓰기 화면 폼(myForm)의 칸 — 이름 → 값. 고르는 칸(radio·checkbox)·단추는 뺀다(lan 은 보낼 때 넣는다). */
export function writeFields(html) {
  const form = (String(html || '').match(/<form\b[^>]*\bid=["']myForm["'][\s\S]*?<\/form>/i) || [])[0] || '';
  const out = {};
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const name = attrOf(tag, 'name');
    const type = (attrOf(tag, 'type') || 'text').toLowerCase();
    if (!name || ['radio', 'checkbox', 'button', 'submit', 'file', 'image', 'reset'].includes(type)) continue;
    if (!(name in out)) out[name] = attrOf(tag, 'value') ?? '';
  }
  return out;
}

/** 화면이 보내는 칸의 차례(2026-10-30 CDP 로 본 TempWrite 요청 그대로). */
const POST_ORDER = ['bid', 'id', 'groupid', 'grouporder', 'replylevel', 'reply', 'replyexist', 'writershow', 'userid', 'empid', 'deptcode', 'email',
  'hasfiles', 'passwd', 'url', 'type', 'catecode', 'temp', 'menuID', 'fileStr', 'hdn_upload_info', 'hdn_delete_info', 'pinpost', 'sdate', 'edate',
  'pinpostDate', 'lan', 'subject_e', 'msgbody_e', 'subject', 'msgbody'];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * 저장할 폼 — 쓰기 화면의 칸 위에 이 글의 값을 얹는다(한국어 제목 하나, 게시 기간·상단 고정 없음).
 * @returns {URLSearchParams}
 */
export function postBody(fields, { subject, category, writer = 'dept', fileInfo }) {
  const v = {
    ...fields,
    writershow: writer === 'me' ? 'P' : 'D',
    catecode: String(STD_CATEGORY[category] || STD_CATEGORY.ETC),
    temp: '0', menuID: fields.menuID ?? '',
    fileStr: fileInfo, hdn_upload_info: fileInfo, hdn_delete_info: '',
    pinpost: '0', sdate: '', edate: '', pinpostDate: '',
    lan: 'K', subject_e: '', msgbody_e: '',
    subject, msgbody: `<p>${esc(subject)}</p>`,
  };
  const body = new URLSearchParams();
  for (const k of POST_ORDER) body.append(k, v[k] ?? '');
  return body;
}

/** 시간 제한을 둔 직접 요청(쿠키는 host_permissions 로 실린다). 큰 파일을 올리느라 directFetch(20초)보다 길게 기다린다. */
async function send(url, init, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { credentials: 'include', redirect: 'follow', ...init, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`사이트가 ${Math.round(ms / 1000)}초 안에 답하지 않았습니다.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 표준 PDF 하나를 글 하나로 올린다.
 * @param {{ designation: string, title: string, category?: string, writer?: 'dept'|'me', file: {name: string, type?: string} }} post  기록의 input
 * @param {{ bytes: Uint8Array, onStage?: Function, dry?: boolean }} ctx  dry 면 파일까지만 올리고 글은 저장하지 않는다(시험 — 서버 임시 폴더에 파일이 남는다)
 * @returns {Promise<{ ok: boolean, status: 'posted'|'exists'|'unverified'|'dry', id?: string, url?: string, subject: string, note?: string }>}
 */
export async function stdUpload({ designation, title, category = 'ETC', writer = 'dept', file }, { bytes, onStage = () => {}, dry = false } = {}) {
  const subject = stdSubject(designation, title);
  if (!designation || !title) throw new Error('표준번호와 표준명이 있어야 올립니다.');
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error(`${file?.name || '파일'}: 올릴 파일의 내용이 없습니다.`);

  onStage('같은 표준이 있는지 찾는 중...');
  const before = await stdFind(designation);
  if (before.length) {
    const hit = before[0];
    return { ok: false, status: 'exists', id: hit.id, url: stdPostUrl(hit.id), subject: hit.subject, note: '이미 있음' };
  }

  onStage('쓰기 화면을 확인하는 중...');
  const page = await siteFetch(stdWriteUrl(category));
  if (looksLogin(page.html)) throw new AuthError(LOGIN);
  if (/var\s+authResult\s*=\s*0\b/.test(page.html)) throw new Error('이 게시판에 글을 쓸 권한이 없습니다.');
  // 첨부(multipart)는 탭을 거쳐 보낼 수 없다. 직접 요청이 막힌 환경이면 화면에서 올리게 한다.
  if (page.via === 'tab') throw new Error('확장의 직접 요청이 막혀 올리지 못했습니다. eclass 의 게시판 화면에서 올려 주세요.');
  const fields = writeFields(page.html);
  if (fields.bid !== STD_BOARD || !fields.userid || !fields.empid) throw new Error('게시판 쓰기 화면의 모양이 다릅니다.');

  onStage(`파일을 올리는 중 — ${file.name}`);
  const key = dextAuthKey(await send(DEXT_CONFIG_URL, {}, 20_000));
  if (!key) throw new Error('첨부 컴포넌트의 설정을 읽지 못했습니다.');
  const form = new FormData();
  form.append('DEXTUploadX5_AuthKey', key);
  form.append('DEXTUploadX5_ControlId', DEXT_CONTROL);
  form.append('DEXTUploadX5_UniqueId', `DX5-${Date.now()}-0`);
  form.append('DEXTUploadX5_Folder', '');
  form.append('DEXTUploadX5_EXIFData', '');
  form.append('DEXTUploadX5_FileData', new Blob([bytes], { type: file.type || 'application/pdf' }), file.name);
  form.append('DEXTUploadX5_MetaData', '');
  const up = (await send(`${BASE}/DraftFileUp?pType=SEND&bid=${STD_BOARD}&use=dext`, { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS)).trim();
  // 답은 "SEND:<원래 이름>|<저장 이름>|<크기>|<형식>:" 다. 그 밖이면 받아들여지지 않은 것이다 — 첨부 없이 글을 쓰지 않는다.
  if (!/^SEND:[^|]+\|[^|]*\|\d+\|/.test(up)) throw new Error(looksLogin(up) ? LOGIN : '사이트가 파일을 받지 않았습니다.');
  const fileInfo = up.slice('SEND:'.length);
  if (dry) return { ok: false, status: 'dry', subject, note: `파일만 올려 봄(${fileInfo}) — 글은 저장하지 않음` };

  onStage('글을 저장하는 중...');
  const saved = await send(`${BASE}/TempWrite`, { method: 'POST', headers: FORM, body: postBody(fields, { subject, category, writer, fileInfo }).toString() }, 60_000);
  if (looksLogin(saved)) throw new AuthError(LOGIN);

  onStage('올린 글을 확인하는 중...');
  const after = await stdFind(designation);
  const hit = after.find((r) => !before.some((b) => b.id === r.id));
  if (!hit) return { ok: false, status: 'unverified', subject, note: '글을 저장했지만 게시판에서 찾지 못했습니다 — 게시판을 확인하세요' };
  return { ok: true, status: 'posted', id: hit.id, url: stdPostUrl(hit.id), subject };
}
