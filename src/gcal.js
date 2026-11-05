// 근태를 구글 캘린더 일정으로 — 결재요청이 올라간 뒤 구글 캘린더 「일정 만들기」 창을 채워 여는 주소(2026-11-03 사용자 지정:
// "근태 올릴때 구글 캘린더에 이런식으로 넣을 수 있게 옵션을 넣어줘. 사전정산, 차량조회 옆에 G캘린더").
//
// 물어서 고른 길은 "일정 창을 채워 열기"다 — API(OAuth)로 바로 넣지 않는다. 구글 캘린더의 TEMPLATE 주소에 제목·날짜·시간·장소·설명을
// 실어 새 탭에 열면, 사람이 캘린더(HER·개인업무 …)를 고르고 [저장]을 누른다. 그래서 여기는 주소만 짓는다(순수 함수).
//
// 제목은 팀 캘린더에 이미 있는 일정의 꼴을 따른다(사용자가 보낸 화면 캡처): `[출장-정인철] 선박용 CO2 포집 단위 모듈 시험(울산, KSC)`,
// `[출장-김거화] SSCB 진도점검`, `[외근-문창재] …`, `[휴가-백재해]`, `[오후반차-문창재]`, `[건강검진-문창재]`.
// 하루 이상 걸치는 것(출장·휴가·반차·하루 전체 건강검진)은 종일 일정(캘린더의 막대), 몇 시간짜리(외근·교육·외출·시간 건강검진)는 시각이 있는 일정이다.

import { KINDS, codeOf, halfOf, nameOf, describe } from './attend.js';

export const GCAL_TEMPLATE = 'https://calendar.google.com/calendar/render';
/** 시각이 있는 일정의 시간대 — 주소의 시각은 이 시간대의 벽시계 시각이다. */
export const GCAL_TZ = 'Asia/Seoul';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/** G캘린더를 켤 수 있는 종류 — 유연근무는 자리를 비우는 근태가 아니라 없다. */
export const gcalKind = (kind) => !!KINDS[kind] && kind !== 'flex';

/** 제목 머리의 종류 이름 — 출장 · 외근 · 교육 · 외출 · 연차 · 오전반차 · 오후반차 · 체력단련 · 건강검진. 부서소통회도 외근이다. */
export function gcalLabel(form) {
  const k = form?.kind;
  if (k === 'out') return codeOf(form) === 'TR' ? '교육' : '외근';
  if (k === 'leave') {
    const half = halfOf(form);
    return half === 'am' ? '오전반차' : half === 'pm' ? '오후반차' : nameOf(form);
  }
  if (k === 'health') return '건강검진';
  return KINDS[k]?.label || '';
}

const ymd = (s) => s.replace(/-/g, '');
/** 날짜 하루 뒤(종일 일정의 끝은 마지막 날의 다음 날이다 — 구글 캘린더 주소의 약속). */
function nextDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
}

/** 종일 일정인가 — 몇 시간짜리(외근·교육·외출·시간 건강검진)만 시각이 있다. */
const allDayOf = (form) => !(form.kind === 'out' || form.kind === 'leaveout' || (form.kind === 'health' && !form.allDay));

/**
 * 근태 폼 → 일정 하나.
 * @param {object} form 올린 폼(src/attend.js 의 폼 — settle 을 거친 것)
 * @param {{name?: string, docNo?: string}} [who] name 은 제목의 내 이름, docNo 는 설명에 적는 HR 문서번호
 * @returns {{title: string, allDay: boolean, dates: string, location: string, details: string}|null} 만들 수 없는 폼이면 null
 */
export function gcalEvent(form, { name = '', docNo = '' } = {}) {
  if (!gcalKind(form?.kind) || !DATE_RE.test(form.dateFrom || '')) return null;
  const label = gcalLabel(form);
  const head = `[${label}${name ? `-${name}` : ''}]`;
  const purpose = String(form.purpose || '').trim();
  const where = form.kind === 'trip' ? [form.place, form.venue].map((s) => String(s || '').trim()).filter(Boolean) : [];
  // 연차·체력단련은 사유가 없다. 건강검진의 사유가 "건강검진"이면 제목에 한 번만 적는다.
  const what = form.kind === 'leave' || (form.kind === 'health' && (!purpose || purpose.includes('건강검진'))) ? ''
    : `${purpose}${where.length ? `(${where.join(', ')})` : ''}`;
  const title = what ? `${head} ${what}` : head;
  const allDay = allDayOf(form);
  const last = form.kind === 'trip' || form.kind === 'leave' ? (DATE_RE.test(form.dateTo || '') ? form.dateTo : form.dateFrom) : form.dateFrom;
  let dates;
  if (allDay) {
    dates = `${ymd(form.dateFrom)}/${ymd(nextDay(last))}`;
  } else {
    if (!HHMM_RE.test(form.start || '') || !HHMM_RE.test(form.end || '')) return null;
    const at = (t) => `${ymd(form.dateFrom)}T${t.replace(':', '')}00`;
    dates = `${at(form.start)}/${at(form.end)}`;
  }
  // 장소: 출장은 "출장지 장소"(지도에서 찾을 수 있게 — KSC 만으로는 모른다). 외근은 장소 칸이 없다(목적에 같이 적는다).
  const location = where.join(' ');
  const details = [`HR 근태 신청 — ${describe(form)}`, docNo ? `문서번호 ${docNo}` : ''].filter(Boolean).join('\n');
  return { title, allDay, dates, location, details };
}

/**
 * 구글 캘린더 「일정 만들기」 창의 주소. 만들 수 없는 폼이면 ''.
 * @param {object} form
 * @param {{name?: string, docNo?: string}} [who]
 */
export function gcalUrl(form, who) {
  const ev = gcalEvent(form, who);
  if (!ev) return '';
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: ev.dates, details: ev.details });
  if (ev.location) q.set('location', ev.location);
  if (!ev.allDay) q.set('ctz', GCAL_TZ);
  return `${GCAL_TEMPLATE}?${q}`;
}
