// 메일 수신(회신 추적)의 장부 꼴과 순수 로직(mailtrack/model.js) — 장부 꼴 맞추기·도메인·제목 견주기·받는 사람 → 기대 키·양식 가리기·새 항목·상태(N/M)·
// 갱신 조회 창·병합 출처. 네트워크·chrome·IndexedDB 없음. `node mailtrack/test/model.test.mjs` 로도, node --test 로도 돈다.
import assert from 'node:assert/strict';

import {
  BOOK_KEY, BOOK_VERSION, DEFAULTS, normalizeBook, domainOf, normalizeSubject, expectOf, templateKind, newItem, statusOf, withStatus, sinceOf, sourceOf,
  isoTime, downloadable, attachmentsOf, normalizeItem,
} from '../model.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ME = 'me@krs.co.kr';
const H = 60 * 60 * 1000;
const D = 24 * H;
const A = (address, name = '') => ({ name, address });

console.log('장부 꼴');
t('키·버전·설정 기본값 — 계획서 3.2 그대로', () => {
  assert.equal(BOOK_KEY, 'mailtrackBook');
  assert.equal(BOOK_VERSION, 2, '2 = 받을 곳을 받는 사람(To)에서만 세운다');
  assert.deepEqual({ ...DEFAULTS }, { mcpUrl: 'http://localhost:5001/mcp', userEmail: '', sentDays: 30, windowDays: 90, ownByAddress: true, useHeaders: false, autoRefreshMin: 10, requireAccept: false });
});
t('normalizeBook — 없거나 깨진 것은 기본값', () => {
  const empty = { v: 2, me: '', settings: { ...DEFAULTS }, items: [], syncedUntil: '', lastSync: { at: 0, ok: false, error: '', fetched: 0, linked: 0, kind: '' } };
  assert.deepEqual(normalizeBook(undefined), empty);
  assert.deepEqual(normalizeBook('망가짐'), empty);
  assert.deepEqual(normalizeBook([1, 2]), empty);
  const b = normalizeBook({ me: ' ME@KRS.co.kr ', settings: { sentDays: '14', windowDays: -3, ownByAddress: false, useHeaders: 'yes', autoRefreshMin: 0, mcpUrl: '  ', requireAccept: 'on' }, items: 'x' });
  assert.equal(b.me, ME, '주소는 소문자·공백 없이');
  assert.deepEqual(b.settings, { mcpUrl: DEFAULTS.mcpUrl, userEmail: '', sentDays: 14, windowDays: 90, ownByAddress: false, useHeaders: false, autoRefreshMin: 0, requireAccept: false }, 'requireAccept 는 true 일 때만 켜진다');
  assert.deepEqual(b.items, []);
});
t('normalizeBook — 같은 id 는 앞의 것만, id 없는 항목은 버림, 항목마다 status·subjectKey 를 다시 셈, 두 번 불러도 같다', () => {
  const raw = {
    items: [
      { id: 'm1', subject: 'RE: 자료 요청', expect: [{ key: 'foo.com', state: 'done' }, { key: 'addr:kim@krs.co.kr', state: 'weird' }], status: { expected: 99 } },
      { id: 'm1', subject: '두 번째' },
      { subject: 'id 없음' },
    ],
  };
  const b = normalizeBook(raw);
  assert.equal(b.items.length, 1);
  const it = b.items[0];
  assert.equal(it.subjectKey, '자료 요청');
  assert.deepEqual(it.status, { expected: 2, responded: 1, excluded: 0, done: false });
  assert.deepEqual(it.expect.map((e) => [e.key, e.kind, e.label, e.state]), [['foo.com', 'domain', 'foo.com', 'done'], ['addr:kim@krs.co.kr', 'address', 'kim@krs.co.kr', 'open']]);
  assert.deepEqual(normalizeBook(b), b, '멱등');
  assert.deepEqual(normalizeBook(JSON.parse(JSON.stringify(b))), b, 'JSON 왕복(chrome.storage)에도 같다');
});
t('normalizeBook — v1 장부(참조에서도 받을 곳을 세우던 때)는 받는 사람(To)의 받을 곳만 남기고 v2 로 올린다(2026-10-15 "참조는 추적을 하지 않아")', () => {
  const item = {
    id: 'old', subject: '견적 송부', sentAt: '2026-10-15T06:06:00Z', from: A(ME), to: [A('cs@foo.com')], cc: [A('a@krs.co.kr'), A('b@krs.co.kr'), A('x@foo.com')],
    expect: [
      { key: 'foo.com', kind: 'domain', label: 'foo.com', addresses: ['cs@foo.com', 'x@foo.com'], state: 'open' },
      { key: 'addr:a@krs.co.kr', kind: 'address', label: 'A', addresses: ['a@krs.co.kr'], state: 'done', manual: true, by: 'a@krs.co.kr' },
      { key: 'addr:b@krs.co.kr', kind: 'address', label: 'B', addresses: ['b@krs.co.kr'], state: 'excluded', manual: true },
    ],
    replies: [
      { id: 'r-a', from: A('a@krs.co.kr'), key: 'addr:a@krs.co.kr', kind: 'reply', score: 3, counted: true, review: 'accepted' },
      { id: 'r-cs', from: A('cs@foo.com'), key: 'foo.com', kind: 'reply', score: 3, counted: true, review: 'accepted' },
      { id: 'r-x', from: A('z@zed.com'), key: null, kind: 'reply', score: 3, counted: false },
    ],
  };
  for (const v of [undefined, 1]) {
    const b = normalizeBook({ v, me: ME, items: [item] });
    const it = b.items[0];
    assert.equal(b.v, 2);
    assert.deepEqual(it.expect.map((e) => [e.key, e.addresses, e.state]), [['foo.com', ['cs@foo.com'], 'open']], `v=${v}: 참조에서 세운 곳은 지우고 같은 회사 참조자 주소도 뺀다`);
    assert.deepEqual(it.replies.map((r) => [r.id, r.key, r.counted]), [['r-a', null, false], ['r-cs', 'foo.com', true], ['r-x', null, false]], '지운 곳의 회신은 대상 아님');
    assert.deepEqual(it.cc.map((a) => a.address), ['a@krs.co.kr', 'b@krs.co.kr', 'x@foo.com'], 'cc 는 보이도록 남긴다');
    assert.deepEqual(it.status, { expected: 1, responded: 0, excluded: 0, done: false });
    assert.deepEqual(normalizeBook(b), b, '올린 뒤에는 그대로');
    assert.deepEqual(normalizeBook(JSON.parse(JSON.stringify(b))), b);
  }
  const kept = normalizeBook({ v: 2, me: ME, items: [item] }).items[0];
  assert.deepEqual(kept.expect.map((e) => e.key), ['foo.com', 'addr:a@krs.co.kr', 'addr:b@krs.co.kr'], 'v2 장부는 건드리지 않는다');
  const blind = normalizeBook({ v: 1, me: ME, items: [{ ...item, to: [] }] }).items[0];
  assert.deepEqual(blind.expect.map((e) => e.key), ['foo.com', 'addr:a@krs.co.kr', 'addr:b@krs.co.kr'], 'To 를 모르는 항목은 가를 수 없어 그대로');
});
t('normalizeItem — 회신·첨부·양식 꼴, 인라인 첨부는 빠짐, serverPath 는 남김', () => {
  const it = normalizeItem({
    id: 'm1', replies: [{ id: 'r1', from: { emailAddress: { name: '김', address: 'KIM@Foo.com' } }, key: 'FOO.COM', kind: 'nope', score: 9, counted: true, attachments: [{ id: 'a', name: 'x.xlsx', isInline: false, serverPath: 'C:/x.xlsx' }, { id: 'i', name: 'logo.png', isInline: true }] }, { id: 'r1' }, { from: 'x' }],
    templates: [{ attachmentId: 't1', name: '양식.docx' }, { attachmentId: 't2', name: 'old.xls' }],
  });
  assert.equal(it.replies.length, 1);
  const r = it.replies[0];
  assert.deepEqual(r.from, { name: '김', address: 'kim@foo.com' });
  assert.deepEqual([r.key, r.kind, r.score, r.counted, r.manual, r.bodyStored], ['foo.com', 'reply', 0, true, false, false]);
  assert.deepEqual([r.review, r.reviewedAt], ['pending', ''], 'review 가 없는 옛 회신은 확인 필요');
  assert.deepEqual(r.attachments.map((a) => [a.id, a.serverPath]), [['a', 'C:/x.xlsx']]);
  const reviewed = normalizeItem({ id: 'm2', replies: [{ id: 'a', review: 'accepted', reviewedAt: '2026-10-15T01:00:00Z' }, { id: 'b', review: 'rejected' }, { id: 'c', review: 'nope' }] }).replies;
  assert.deepEqual(reviewed.map((x) => [x.review, x.reviewedAt]), [['accepted', '2026-10-15T01:00:00Z'], ['rejected', ''], ['pending', '']]);
  assert.deepEqual(it.templates, [{ attachmentId: 't1', name: '양식.docx', kind: 'docx', stored: false }], '병합 못 하는 .xls 는 양식이 아니다');
  assert.equal(normalizeItem({ subject: 'x' }), null);
});

console.log('도메인·제목');
t('domainOf — 마지막 @ 뒤 소문자, 없으면 빈 글', () => {
  assert.equal(domainOf('Kim@Foo.COM'), 'foo.com');
  assert.equal(domainOf('"a@b"@Mail.Example.org'), 'mail.example.org');
  assert.equal(domainOf('/O=EXCHANGELABS/OU=EXCHANGE'), '');
  assert.equal(domainOf(''), '');
  assert.equal(domainOf(null), '');
});
t('normalizeSubject — RE:/FW:/회신:/전달:/[외부] 머리표를 반복해 떼고, 공백 접고, 소문자', () => {
  assert.equal(normalizeSubject('RE: 자료 요청'), '자료 요청');
  assert.equal(normalizeSubject('  RE: [외부] Fw:  회신: 전달:   Hello   World '), 'hello world');
  assert.equal(normalizeSubject('[EXTERNAL] RE: RE: FWD: Data Request'), 'data request');
  assert.equal(normalizeSubject('[SPAM] [외부메일] 답장: 견적'), '견적');
  assert.equal(normalizeSubject('Re : 띄운 콜론'), '띄운 콜론');
  assert.equal(normalizeSubject('RE[2]: 번호 붙은 회신'), '번호 붙은 회신');
  assert.equal(normalizeSubject('회신：전각 콜론'), '전각 콜론');
  assert.equal(normalizeSubject('Review: 머리표가 아닌 낱말'), 'review: 머리표가 아닌 낱말', 're 로 시작하는 낱말은 떼지 않는다');
  assert.equal(normalizeSubject('[KRS] 회의'), '[krs] 회의', '모르는 대괄호는 남긴다');
  assert.equal(normalizeSubject('RE:'), '');
  assert.equal(normalizeSubject(undefined), '');
  assert.equal(normalizeSubject('ABC  def'), normalizeSubject('abc def'));
});

console.log('받는 사람 → 기대 키');
t('expectOf — 외부는 도메인 하나가 키 하나(여러 명은 addresses), 내 도메인은 주소마다, 첫 등장 차례', () => {
  const ex = expectOf({
    to: [A('kim@foo.com', '김'), A('lee@krs.co.kr', '이'), A('park@bar.org'), A('choi@foo.com'), A('jung@krs.co.kr')],
    me: ME,
  });
  assert.deepEqual(ex.map((e) => e.key), ['foo.com', 'addr:lee@krs.co.kr', 'bar.org', 'addr:jung@krs.co.kr']);
  assert.deepEqual(ex[0], { key: 'foo.com', kind: 'domain', label: 'foo.com', addresses: ['kim@foo.com', 'choi@foo.com'], state: 'open', manual: false, doneAt: '', by: '' });
  assert.deepEqual([ex[1].kind, ex[1].label, ex[1].addresses], ['address', '이', ['lee@krs.co.kr']], '주소 키의 이름표는 사람 이름(없으면 주소)');
  assert.equal(ex[3].label, 'jung@krs.co.kr');
});
t('expectOf — 참조(CC)는 받을 곳이 아니다(2026-10-15 "참조는 추적을 하지 않아. 받는 사람 뿐이야.") — cc 를 줘도 보지 않는다', () => {
  const ex = expectOf({ to: [A('kim@foo.com', '김')], cc: [A('choi@foo.com'), A('park@bar.org'), A('jung@krs.co.kr')], me: ME });
  assert.deepEqual(ex.map((e) => [e.key, e.addresses]), [['foo.com', ['kim@foo.com']]], '같은 회사 참조자도 addresses 에 들지 않는다');
  assert.deepEqual(expectOf({ cc: [A('park@bar.org')], me: ME }), [], '참조만 있는 메일은 기다릴 곳이 없다');
});
t('expectOf — ownByAddress:false 면 내 도메인도 도메인 키 하나', () => {
  const ex = expectOf({ to: [A('lee@krs.co.kr'), A('kim@foo.com'), A('jung@krs.co.kr')], me: ME, ownByAddress: false });
  assert.deepEqual(ex.map((e) => [e.key, e.kind, e.addresses]), [['krs.co.kr', 'domain', ['lee@krs.co.kr', 'jung@krs.co.kr']], ['foo.com', 'domain', ['kim@foo.com']]]);
});
t('expectOf — 나·빈 주소·겹친 주소(대소문자 무시)는 뺀다', () => {
  const ex = expectOf({
    to: [A('ME@KRS.CO.KR'), A(''), { emailAddress: { name: '김', address: 'Kim@Foo.com' } }, 'kim@foo.com', A('KIM@FOO.COM'), A('lee@krs.co.kr'), A('Lee@KRS.co.kr')],
    me: 'Me@Krs.Co.Kr',
  });
  assert.deepEqual(ex.map((e) => [e.key, e.addresses]), [['foo.com', ['kim@foo.com']], ['addr:lee@krs.co.kr', ['lee@krs.co.kr']]]);
  assert.deepEqual(expectOf({ to: [A(ME)], me: ME }), [], '나에게만 보낸 메일은 기다릴 곳이 없다');
  assert.deepEqual(expectOf({}), []);
});
t('expectOf — me 를 모르면(첫 등록 전) 내 도메인도 외부처럼 묶이고, 도메인 없는 주소는 주소 키', () => {
  assert.deepEqual(expectOf({ to: [A('lee@krs.co.kr'), A('jung@krs.co.kr')] }).map((e) => e.key), ['krs.co.kr']);
  assert.deepEqual(expectOf({ to: [A('/o=exchangelabs/cn=kim')], me: ME }).map((e) => [e.key, e.kind]), [['addr:/o=exchangelabs/cn=kim', 'address']]);
  assert.deepEqual(expectOf({ to: [A('x@krs.co.kr'), A('y@foo.com')], me: [ME, 'x@krs.co.kr'] }).map((e) => e.key), ['foo.com'], 'me 는 별칭 목록도 받는다');
});

console.log('양식');
t('templateKind — .xlsx·.docx 만(대소문자 무시), 옛 형식·매크로·임시 파일은 아님', () => {
  assert.equal(templateKind('제출 양식.xlsx'), 'xlsx');
  assert.equal(templateKind('REPORT.DOCX'), 'docx');
  assert.equal(templateKind('폴더/양식.Docx'), 'docx');
  for (const n of ['old.xls', 'old.doc', 'macro.xlsm', 'macro.docm', 'a.pdf', 'a.hwp', '~$양식.xlsx', '', null, 'xlsx']) assert.equal(templateKind(n), null, String(n));
});
t('downloadable·attachmentsOf — 본문 속 그림과 첨부 메일·링크는 바이트가 없다', () => {
  assert.equal(downloadable({ odataType: '#microsoft.graph.fileAttachment' }), true);
  assert.equal(downloadable({ '@odata.type': '#microsoft.graph.fileAttachment' }), true);
  assert.equal(downloadable({}), true, '갈래를 모르면 받아 본다');
  assert.equal(downloadable({ odataType: '#microsoft.graph.itemAttachment' }), false);
  assert.equal(downloadable({ odataType: '#microsoft.graph.referenceAttachment' }), false);
  assert.equal(downloadable({ odataType: '#microsoft.graph.fileAttachment', isInline: true }), false);
  assert.deepEqual(attachmentsOf([{ id: 'a', name: 'x', isInline: true }, { id: 'b', name: 'y' }, { id: 'b', name: 'dup' }, { name: 'no id' }]).map((a) => a.id), ['b']);
});

console.log('새 항목·상태');
const FULL = {
  id: 'sent-1', subject: '[외부] 2026 실적 자료 요청', from: A(ME, '나'), sender: A(ME), to: [A('kim@foo.com', '김'), A('lee@krs.co.kr', '이')], cc: [A('choi@foo.com'), A(ME)],
  sentAt: '2026-10-10T01:00:00Z', receivedAt: '2026-10-10T01:00:02Z', conversationId: 'conv-1', internetMessageId: '<sent-1@krs.co.kr>', hasAttachments: true, isDraft: false,
  body: { contentType: 'html', content: '<p>양식을 채워 주세요</p>' }, preview: '양식을 채워 주세요', webLink: 'https://outlook.office.com/x',
};
const META = {
  id: 'sent-1', subject: FULL.subject, from: A(ME), to: FULL.to, receivedAt: FULL.receivedAt, hasAttachments: true, body: FULL.body,
  attachments: [
    { id: 'att-x', name: '실적양식.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 9000, isInline: false, odataType: '#microsoft.graph.fileAttachment' },
    { id: 'att-p', name: '안내.pdf', contentType: 'application/pdf', size: 2000, isInline: false, odataType: '#microsoft.graph.fileAttachment' },
    { id: 'att-i', name: 'image001.png', contentType: 'image/png', size: 100, isInline: true, odataType: '#microsoft.graph.fileAttachment' },
    { id: 'att-d', name: '참고 양식.docx', contentType: 'x', size: 10, isInline: false, odataType: '#microsoft.graph.referenceAttachment' },
  ],
};
t('newItem — 상세의 To 로 기대 키(CC 는 보이기만), 내 첨부의 xlsx·docx 가 양식(바이트 받을 수 있는 것만), 인라인 그림은 빠짐', () => {
  const it = newItem(FULL, META, { me: ME, now: Date.parse('2026-10-15T00:00:00Z'), ownByAddress: true });
  assert.equal(it.id, 'sent-1');
  assert.deepEqual([it.conversationId, it.internetMessageId, it.subjectKey, it.sentAt, it.registeredAt, it.webLink], ['conv-1', '<sent-1@krs.co.kr>', '2026 실적 자료 요청', '2026-10-10T01:00:00Z', '2026-10-15T00:00:00Z', FULL.webLink]);
  assert.deepEqual(it.from, { name: '나', address: ME });
  assert.deepEqual(it.cc.map((a) => a.address), ['choi@foo.com', ME], 'cc 는 메일 그대로(나 포함) 보이기만 — 받을 곳이 되지 않는다');
  assert.deepEqual(it.expect.map((e) => e.key), ['foo.com', 'addr:lee@krs.co.kr']);
  assert.deepEqual(it.expect[0].addresses, ['kim@foo.com'], '참조의 choi@foo.com 은 foo.com 의 주소에도 들지 않는다');
  assert.deepEqual(it.attachments.map((a) => [a.id, a.stored, a.missing]), [['att-x', false, false], ['att-p', false, false], ['att-d', false, false]]);
  assert.deepEqual(it.templates, [{ attachmentId: 'att-x', name: '실적양식.xlsx', kind: 'xlsx', stored: false }]);
  assert.deepEqual(it.replies, []);
  assert.deepEqual(it.status, { expected: 2, responded: 0, excluded: 0, done: false });
  assert.deepEqual([it.synced, it.closed, it.note], [false, false, '']);
  assert.deepEqual(normalizeItem(it), it, '새 항목은 이미 장부 꼴');
});
t('newItem — me 를 모르면 보낸 주소를 나로 친다, meta 가 없으면 첨부·양식 없음, sentAt 이 없으면 receivedAt', () => {
  const it = newItem({ ...FULL, sentAt: '' }, null, { me: '', now: 0 });
  assert.deepEqual(it.expect.map((e) => e.key), ['foo.com', 'addr:lee@krs.co.kr'], '보낸 주소의 도메인이 내 도메인');
  assert.deepEqual([it.attachments, it.templates, it.sentAt], [[], [], FULL.receivedAt]);
  assert.deepEqual(newItem(FULL, META, { me: ME, ownByAddress: false }).expect.map((e) => e.key), ['foo.com', 'krs.co.kr']);
});
t('statusOf·withStatus — expected 는 빼지 않은 키, responded 는 그중 완료, done 은 다 찼을 때만(기다릴 키가 없으면 완료 아님)', () => {
  const ex = (...st) => ({ expect: st.map((state, i) => ({ key: 'k' + i, state })) });
  assert.deepEqual(statusOf(ex('done', 'open', 'excluded')), { expected: 2, responded: 1, excluded: 1, done: false });
  assert.deepEqual(statusOf(ex('done', 'done', 'excluded')), { expected: 2, responded: 2, excluded: 1, done: true });
  assert.deepEqual(statusOf(ex('excluded')), { expected: 0, responded: 0, excluded: 1, done: false });
  assert.deepEqual(statusOf({}), { expected: 0, responded: 0, excluded: 0, done: false });
  const w = withStatus({ id: 'x', ...ex('done'), status: { expected: 9 } });
  assert.deepEqual(w.status, { expected: 1, responded: 1, excluded: 0, done: true });
  assert.equal(w.id, 'x');
});

console.log('갱신 조회 창');
const NOW = Date.parse('2026-10-15T09:00:00Z');
const item = (id, sentAt, extra = {}) => withStatus({ id, sentAt, expect: [{ key: 'foo.com', state: 'open' }], synced: false, closed: false, ...extra });
t('isoTime — 밀리초 없는 UTC, 못 읽으면 빈 글', () => {
  assert.equal(isoTime(Date.parse('2026-10-15T09:00:00.123Z')), '2026-10-15T09:00:00Z');
  assert.equal(isoTime(new Date('2026-10-15T09:00:00Z')), '2026-10-15T09:00:00Z');
  assert.equal(isoTime('2026-10-15T18:00:00+09:00'), '2026-10-15T09:00:00Z');
  assert.equal(isoTime('아님'), '');
});
t('sinceOf — 처음은 보낸 때 − 1시간, 열린 항목 중 가장 이른 것', () => {
  const b = { settings: { windowDays: 90 }, syncedUntil: '', items: [item('a', '2026-10-12T00:00:00Z'), item('b', '2026-10-10T05:00:00Z')] };
  assert.equal(sinceOf(b, NOW), '2026-10-10T04:00:00Z');
});
t('sinceOf — 한 번 조회한 항목(synced)은 syncedUntil − 1시간, 아직 안 한 새 항목이 더 이르면 그것', () => {
  const b = { settings: { windowDays: 90 }, syncedUntil: '2026-10-15T08:00:00Z', items: [item('a', '2026-10-01T00:00:00Z', { synced: true })] };
  assert.equal(sinceOf(b, NOW), '2026-10-15T07:00:00Z');
  b.items.push(item('b', '2026-10-14T00:00:00Z'));
  assert.equal(sinceOf(b, NOW), '2026-10-13T23:00:00Z');
});
t('sinceOf — windowDays 보다 앞으로는 가지 않는다', () => {
  const b = { settings: { windowDays: 7 }, syncedUntil: '', items: [item('old', '2026-06-01T00:00:00Z')] };
  assert.equal(sinceOf(b, NOW), isoTime(NOW - 7 * D));
  assert.equal(sinceOf({ settings: {}, items: [item('old', '2026-01-01T00:00:00Z')] }, NOW), isoTime(NOW - 90 * D), '기본 90일');
  assert.equal(sinceOf({ settings: {}, items: [item('bad', '')] }, NOW), isoTime(NOW - 90 * D), '보낸 때를 모르면 창 끝에서');
});
t('sinceOf — 열린 항목이 없으면 null(완료·닫힘은 빼고 본다)', () => {
  const done = withStatus({ id: 'd', sentAt: '2026-10-01T00:00:00Z', expect: [{ key: 'foo.com', state: 'done' }] });
  const closed = item('c', '2026-10-01T00:00:00Z', { closed: true });
  assert.equal(sinceOf({ settings: {}, items: [done, closed] }, NOW), null);
  assert.equal(sinceOf({ settings: {}, items: [] }, NOW), null);
  assert.equal(sinceOf(null, NOW), null);
  const later = item('o', '2026-10-14T00:00:00Z');
  assert.equal(sinceOf({ settings: {}, items: [done, closed, later] }, NOW), '2026-10-13T23:00:00Z', '완료 항목의 보낸 때는 창을 넓히지 않는다');
  assert.equal(sinceOf({ settings: {}, syncedUntil: '2026-10-15T08:00:00Z', items: [done, later] }, NOW, { all: true }), '2026-09-30T23:00:00Z', 'all — 닫지 않은 모든 항목을 보낸 때부터');
});

console.log('병합 출처');
t('sourceOf — org 는 도메인 키, 주소 키·키 없음은 보낸 주소의 도메인, 날짜는 YYYY-MM-DD', () => {
  assert.deepEqual(sourceOf({ from: A('kim@foo.com', '김철수'), key: 'foo.com', receivedAt: '2026-10-15T03:00:00Z' }), { org: 'foo.com', name: '김철수', address: 'kim@foo.com', date: '2026-10-15' });
  assert.deepEqual(sourceOf({ from: { emailAddress: { name: '이', address: 'Lee@KRS.co.kr' } }, key: 'addr:lee@krs.co.kr', receivedAt: '2026-10-15T03:00:00Z' }).org, 'krs.co.kr');
  assert.equal(sourceOf({ from: A('x@sub.bar.org'), key: null }).org, 'sub.bar.org');
  assert.deepEqual(sourceOf({ from: A('/o=ex/cn=kim') }), { org: '/o=ex/cn=kim', name: '', address: '/o=ex/cn=kim', date: '' });
  assert.deepEqual(sourceOf(undefined), { org: '', name: '', address: '', date: '' });
});

console.log(`\n${pass} passed`);
