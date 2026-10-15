// 받은 메일 → 회신 잇기(mailtrack/match.js) — 분류(내 메일·배달 실패·자동 회신·사람의 답)·기대 키 찾기·점수 3/2/1/0·한 메일 한 항목 연결과 동점 규칙·
// 갈래별 세기·회신 더하기(중복·수동 표시)·수동 조작(키 상태·연결·떼기·세기). 순수 함수만 — 네트워크 없음.
import assert from 'node:assert/strict';

import { AUTO_SUBJECT, NDR_SUBJECT, SYSTEM_FROM, classify, keyOf, scoreOf, matchAll, applyReplies, setExpect, linkReply, unlinkReply, setCounted, setReview } from '../match.js';
import { newItem, normalizeItem } from '../model.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ME = 'me@krs.co.kr';
const A = (address, name = '') => ({ name, address });
const MIN = 60 * 1000;
const at = (base, deltaMin = 0) => new Date(Date.parse(base) + deltaMin * MIN).toISOString().replace(/\.\d{3}Z$/, 'Z');

const SENT1 = '2026-10-10T01:00:00Z';
/** 보낸 메일 하나 → 장부 항목(To: foo.com 둘·lee@krs.co.kr, CC: bar.org). */
const mkItem = (id = 'sent-1', extra = {}) => newItem({
  id, subject: '실적 자료 요청', from: A(ME, '나'), to: [A('kim@foo.com', '김'), A('choi@foo.com'), A('lee@krs.co.kr', '이')], cc: [A('park@bar.org')],
  sentAt: SENT1, conversationId: 'conv-' + id, internetMessageId: `<${id}@krs.co.kr>`, ...extra,
}, null, { me: ME, now: 0 });
/** 받은 메일(MailHead 꼴). */
const mail = (id, from, extra = {}) => ({
  id, subject: 'RE: 실적 자료 요청', from: typeof from === 'string' ? A(from) : from, to: [A(ME)], cc: [], receivedAt: at(SENT1, 60), conversationId: 'conv-x',
  internetMessageId: `<${id}@x>`, hasAttachments: false, isDraft: false, webLink: 'https://outlook/x/' + id, ...extra,
});

console.log('분류');
t('정규식 목록 — 계획 4절 2 의 꼴을 담는다', () => {
  for (const list of [AUTO_SUBJECT, NDR_SUBJECT, SYSTEM_FROM]) assert.ok(Array.isArray(list) && list.length && list.every((re) => re instanceof RegExp));
});
t('classify — 내 메일(대소문자 무시)은 self', () => {
  assert.equal(classify(mail('a', 'ME@KRS.co.kr'), { me: ME }), 'self');
  assert.equal(classify(mail('a', { emailAddress: { address: 'me@krs.co.kr' } }), { me: ME }), 'self');
  assert.equal(classify(mail('a', 'me@krs.co.kr'), { me: '' }), 'reply', '나를 모르면 self 로 가르지 않는다');
});
t('classify — 시스템 주소·배달 실패 제목은 ndr', () => {
  for (const f of ['postmaster@foo.com', 'MAILER-DAEMON@foo.com', 'no-reply@foo.com', 'noreply@foo.com', 'do-not-reply@foo.com', 'donotreply@foo.com', 'bounce+abc@sendgrid.net', 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@krs.co.kr']) {
    assert.equal(classify(mail('a', f), { me: ME }), 'ndr', f);
  }
  for (const s of ['Undeliverable: 실적 자료 요청', '배달 못 함: 실적 자료 요청', '배달 실패: x', '배달되지 않음: x', 'Delivery Status Notification (Failure)', 'Delivery has failed to these recipients', 'Mail delivery failed: returning message', 'Returned mail: see transcript', '전달 실패 알림']) {
    assert.equal(classify(mail('a', 'kim@foo.com', { subject: s }), { me: ME }), 'ndr', s);
  }
});
t('classify — 자동 회신 제목·Auto-Submitted: auto-* 헤더는 auto', () => {
  for (const s of ['자동 회신: 실적 자료 요청', '자동회신: x', '자동 응답: x', '부재 중: x', 'Automatic reply: x', 'Auto-Reply: x', 'AutoReply: x', 'Out of Office: x', '자리 비움: x', '[외부] 자동 회신: x', 'RE: Automatic reply: x']) {
    assert.equal(classify(mail('a', 'kim@foo.com', { subject: s }), { me: ME }), 'auto', s);
  }
  assert.equal(classify(mail('a', 'kim@foo.com', { headers: { inReplyTo: '', references: '', autoSubmitted: 'auto-replied' } }), { me: ME }), 'auto');
  assert.equal(classify(mail('a', 'kim@foo.com', { headers: { autoSubmitted: 'Auto-Generated' } }), { me: ME }), 'auto');
  assert.equal(classify(mail('a', 'kim@foo.com', { headers: { autoSubmitted: 'no' } }), { me: ME }), 'reply');
});
t('classify — 나머지는 reply(제목 중간의 "자동 회신" 은 머리표가 아니다)', () => {
  assert.equal(classify(mail('a', 'kim@foo.com'), { me: ME }), 'reply');
  assert.equal(classify(mail('a', 'kim@foo.com', { subject: 'RE: 자동 회신 설정 방법 문의' }), { me: ME }), 'auto', '회신 머리표를 뗀 제목이 자동 회신으로 시작하면 auto 쪽으로 본다');
  assert.equal(classify(mail('a', 'kim@foo.com', { subject: 'RE: 메일 자동 회신 설정 문의' }), { me: ME }), 'reply');
  assert.equal(classify({}, { me: ME }), 'reply');
});

console.log('기대 키·점수');
t('keyOf — 도메인 키(하위 도메인 포함), 주소 키, 대리 발송(sender), 없으면 null', () => {
  const it = mkItem();
  assert.equal(keyOf(mail('a', 'kim@foo.com'), it), 'foo.com');
  assert.equal(keyOf(mail('a', 'nobody@FOO.com'), it), 'foo.com', '같은 회사 다른 사람도 그 회사 키');
  assert.equal(keyOf(mail('a', 'x@mail.foo.com'), it), 'foo.com', '하위 도메인');
  assert.equal(keyOf(mail('a', 'x@notfoo.com'), it), null, '끝만 같은 다른 도메인은 아니다');
  assert.equal(keyOf(mail('a', 'Lee@KRS.co.kr'), it), 'addr:lee@krs.co.kr');
  assert.equal(keyOf(mail('a', 'jung@krs.co.kr'), it), null, '받는 사람에 없던 같은 회사 사람은 대상 아님');
  assert.equal(keyOf(mail('a', 'assistant@other.com', { sender: A('assistant@other.com'), from: A('park@bar.org') }), it), 'bar.org');
  assert.equal(keyOf(mail('a', 'x@other.com', { sender: A('park@bar.org') }), it), 'bar.org', 'from 으로 못 찾으면 sender');
  assert.equal(keyOf(mail('a', 'kim@foo.com'), { expect: [] }), null);
});
t('scoreOf 3 — 대화 id 같음, 또는 In-Reply-To/References 에 보낸 메일의 Message-ID', () => {
  const it = mkItem();
  assert.equal(scoreOf(mail('a', 'stranger@x.com', { conversationId: 'conv-sent-1', subject: '딴 제목' }), it), 3, '대화 id 면 보낸 사람·제목을 보지 않는다');
  assert.equal(scoreOf(mail('a', 'x@y.com', { subject: '딴', headers: { inReplyTo: '<sent-1@krs.co.kr>', references: '' } }), it), 3);
  assert.equal(scoreOf(mail('a', 'x@y.com', { subject: '딴', headers: { inReplyTo: '', references: '<a@b> <sent-1@krs.co.kr>' } }), it), 3);
  assert.equal(scoreOf(mail('a', 'x@y.com', { subject: '딴', headers: { inReplyTo: '<other@x>' } }), it), 0);
  // 보내기 전에 받은 메일은 같은 대화라도 답이 아니다 — 내가 "Re:" 로 답한 메일을 등록하면 상대의 원래 메일이 같은 대화 id 다(2026-10-15 실측).
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { conversationId: 'conv-sent-1', receivedAt: at(SENT1, -2) }), it), 0, '보내기 2분 전에 온 같은 대화의 메일(실측 — 받고 2분 뒤 답한 경우)');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { conversationId: 'conv-sent-1', receivedAt: SENT1 }), it), 3, '같은 초는 된다');
  assert.equal(scoreOf(mail('a', 'x@y.com', { subject: '딴', receivedAt: at(SENT1, -1), headers: { inReplyTo: '<sent-1@krs.co.kr>' } }), it), 0, '헤더가 가리켜도 보내기 전이면');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { conversationId: 'conv-sent-1', receivedAt: '' }), it), 3, '받은 때를 모르면 가리지 않는다');
});
t('scoreOf 2 — 머리표 뗀 제목이 같고 기대 키의 사람이 보냈고 보낸 뒤', () => {
  const it = mkItem();
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: '[외부] RE: FW: 실적  자료 요청' }), it), 2);
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { receivedAt: SENT1 }), it), 2, '보낸 것과 같은 초면 된다(두 시각 다 Exchange 가 찍은 것 — 여유 없음)');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { receivedAt: at(SENT1, -1) }), it), 0, '1분이라도 먼저 온 것은 회신이 아니다');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { receivedAt: at(SENT1, -6) }), it), 0, '보내기 전에 온 것은 회신이 아니다');
  assert.equal(scoreOf(mail('a', 'jung@krs.co.kr'), it), 0, '키가 없는 사람은 제목만으로 잇지 않는다');
});
t('scoreOf 1 — 기대 키의 사람이 나에게(To·CC) 보낸 메일 제목에 보낸 제목이 들어 있음, 보낸 뒤', () => {
  const it = mkItem();
  const sub = '실적 자료 요청 관련 추가 문의';
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: sub }), it), 1);
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: sub, to: [A('x@krs.co.kr')], cc: [A('ME@krs.co.kr')] }), it), 1, 'CC 로 받아도');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: sub, to: [A('x@krs.co.kr')] }), it), 0, '나에게 온 것이 아니면');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: sub, to: [A('alias@krs.co.kr')] }), it, { me: ['alias@krs.co.kr'] }), 1, 'opts.me(별칭)');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: sub, receivedAt: at(SENT1, -1) }), it), 0, '보내기 전');
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: '전혀 다른 메일' }), it), 0);
});
t('scoreOf — 보낸 제목이 비었으면 제목으로는 잇지 않는다(대화 id 는 된다)', () => {
  const it = mkItem('s0', { subject: 'RE:' });
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: '' }), it), 0);
  assert.equal(scoreOf(mail('a', 'kim@foo.com', { subject: '', conversationId: 'conv-s0' }), it), 3);
});

console.log('연결');
t('matchAll — 갈래: 사람의 답(점수 ≥ 2)은 세고, 키 없는 답은 "대상 아님"(세지 않음), 점수 1 은 후보, 자동 회신·배달 실패는 저장만, 내 메일·점수 0 은 버림', () => {
  const it = mkItem();
  const mails = [
    mail('r-kim', A('kim@foo.com', '김'), { conversationId: 'conv-sent-1', hasAttachments: true }),
    mail('r-out', 'jung@krs.co.kr', { conversationId: 'conv-sent-1' }),
    mail('r-cand', 'park@bar.org', { subject: '실적 자료 요청 건 질문' }),
    mail('r-auto', 'lee@krs.co.kr', { subject: '자동 회신: 실적 자료 요청', conversationId: 'conv-sent-1' }),
    mail('r-ndr', 'postmaster@foo.com', { subject: 'Undeliverable: 실적 자료 요청', conversationId: 'conv-sent-1' }),
    mail('r-me', ME, { conversationId: 'conv-sent-1' }),
    mail('r-none', 'kim@foo.com', { subject: '점심 약속' }),
  ];
  const { linked, unmatched } = matchAll(mails, [it], { me: ME });
  const by = Object.fromEntries(linked.map((l) => [l.reply.id, l]));
  assert.deepEqual(Object.keys(by), ['r-kim', 'r-out', 'r-cand', 'r-auto', 'r-ndr']);
  assert.equal(unmatched, 1, '점수 0 하나(내 메일은 세지 않는다)');
  assert.ok(linked.every((l) => l.itemId === 'sent-1'));
  assert.deepEqual(by['r-kim'].reply, {
    id: 'r-kim', from: { name: '김', address: 'kim@foo.com' }, key: 'foo.com', receivedAt: at(SENT1, 60), subject: 'RE: 실적 자료 요청', conversationId: 'conv-sent-1', hasAttachments: true,
    kind: 'reply', score: 3, counted: true, manual: false, attachments: [], bodyStored: false, webLink: 'https://outlook/x/r-kim', review: 'pending', reviewedAt: '',
  });
  const k = (id) => [by[id].reply.kind, by[id].reply.key, by[id].reply.counted, by[id].reply.score];
  assert.deepEqual(k('r-out'), ['reply', null, false, 3], '대상 아님');
  assert.deepEqual(k('r-cand'), ['candidate', 'bar.org', false, 1]);
  assert.deepEqual(k('r-auto'), ['auto', 'addr:lee@krs.co.kr', false, 3]);
  assert.deepEqual(k('r-ndr'), ['ndr', 'foo.com', false, 3], '그 회사의 postmaster 면 키는 찾지만 세지 않는다');
});
t('matchAll — 메일 하나는 항목 하나: 점수 높은 쪽, 동점이면 sentAt ≤ receivedAt 인 가장 늦게 보낸 항목', () => {
  const old = mkItem('old', { sentAt: '2026-10-01T00:00:00Z' });
  const mid = mkItem('mid', { sentAt: '2026-10-05T00:00:00Z' });
  const future = mkItem('future', { sentAt: '2026-10-20T00:00:00Z' });
  const m = mail('r1', 'kim@foo.com', { receivedAt: '2026-10-06T00:00:00Z' });
  const r = matchAll([m], [old, future, mid], { me: ME });
  assert.deepEqual(r.linked.map((l) => l.itemId), ['mid'], '회신보다 뒤에 보낸 항목(future)은 동점이어도 지고, 앞의 것 중 늦은 것');
  const r2 = matchAll([{ ...m, conversationId: 'conv-old' }], [old, mid], { me: ME });
  assert.deepEqual(r2.linked.map((l) => l.itemId), ['old'], '점수 3 이 2 를 이긴다');
});
t('matchAll — 이미 어떤 항목에 이어진 id(와 known)는 건너뛰고, 같은 목록 안의 겹친 id 도 한 번만', () => {
  const it = mkItem();
  const linkedOnce = applyReplies(it, matchAll([mail('r1', 'kim@foo.com')], [it], { me: ME }).linked.map((l) => l.reply));
  const other = mkItem('sent-2', { subject: '다른 요청' });
  const r = matchAll([mail('r1', 'kim@foo.com'), mail('r2', 'kim@foo.com'), mail('r2', 'kim@foo.com'), mail('r3', 'kim@foo.com')], [linkedOnce, other], { me: ME, known: new Set(['r3']) });
  assert.deepEqual(r.linked.map((l) => l.reply.id), ['r2']);
  assert.equal(r.unmatched, 0);
  assert.deepEqual(matchAll(null, null), { linked: [], unmatched: 0 });
});

console.log('회신 더하기·완료');
t('applyReplies — 센 회신이 채운 키는 done(by = 보낸 주소, doneAt = 받은 때), 세지 않은 것은 키를 바꾸지 않는다', () => {
  const it = mkItem();
  const { linked } = matchAll([
    mail('r-kim', 'kim@foo.com', { receivedAt: '2026-10-11T00:00:00Z' }),
    mail('r-auto', 'lee@krs.co.kr', { subject: '자동 회신: 실적 자료 요청', conversationId: 'conv-sent-1' }),
  ], [it], { me: ME });
  const x = applyReplies(it, linked.map((l) => l.reply));
  assert.deepEqual(x.expect.map((e) => [e.key, e.state, e.by, e.doneAt]), [
    ['foo.com', 'done', 'kim@foo.com', '2026-10-11T00:00:00Z'], ['addr:lee@krs.co.kr', 'open', '', ''], ['bar.org', 'open', '', ''],
  ]);
  assert.deepEqual(x.status, { expected: 3, responded: 1, excluded: 0, done: false });
  assert.equal(x.replies.length, 2);
  assert.deepEqual(normalizeItem(x), x, '결과는 장부 꼴');
});
t('applyReplies — 같은 회사 두 번째 답은 by 를 바꾸지 않는다(먼저 답한 사람), 다 차면 완료', () => {
  let it = mkItem();
  it = applyReplies(it, [{ id: 'r2', from: A('choi@foo.com'), key: 'foo.com', receivedAt: '2026-10-12T00:00:00Z', kind: 'reply', score: 3, counted: true }]);
  it = applyReplies(it, [{ id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true }]);
  assert.deepEqual([it.expect[0].by, it.expect[0].doneAt], ['kim@foo.com', '2026-10-11T00:00:00Z'], '가장 먼저 받은 센 회신');
  it = applyReplies(it, [
    { id: 'r3', from: A('lee@krs.co.kr'), key: 'addr:lee@krs.co.kr', receivedAt: '2026-10-12T00:00:00Z', kind: 'reply', score: 2, counted: true },
    { id: 'r4', from: A('park@bar.org'), key: 'bar.org', receivedAt: '2026-10-13T00:00:00Z', kind: 'reply', score: 2, counted: true },
  ]);
  assert.deepEqual(it.status, { expected: 3, responded: 3, excluded: 0, done: true });
});
t('applyReplies — 이미 있는 id 는 다시 넣지 않고 있는 것(수동 표시)을 지킨다', () => {
  let it = mkItem();
  it = applyReplies(it, [{ id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true }]);
  it = setCounted(it, 'r1', false);
  assert.equal(it.expect[0].state, 'open');
  const again = applyReplies(it, [{ id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true }, { id: 'r1', kind: 'auto' }]);
  assert.equal(again.replies.length, 1);
  assert.deepEqual([again.replies[0].counted, again.replies[0].manual, again.expect[0].state], [false, true, 'open'], '사람이 뺀 것이 이긴다');
});
t('applyReplies — 수동 키: excluded·done 은 그대로, 수동 open 은 새로 센 회신이 오면만 done 으로 올라간다', () => {
  let it = mkItem();
  it = setExpect(it, 'bar.org', 'excluded');
  it = setExpect(it, 'addr:lee@krs.co.kr', 'done', { now: Date.parse('2026-10-14T00:00:00Z') });
  it = setExpect(it, 'foo.com', 'open');
  assert.deepEqual(it.status, { expected: 2, responded: 1, excluded: 1, done: false });
  it = applyReplies(it, [
    { id: 'p', from: A('park@bar.org'), key: 'bar.org', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true },
    { id: 'k', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-12T00:00:00Z', kind: 'reply', score: 3, counted: true },
  ]);
  assert.deepEqual(it.expect.map((e) => [e.key, e.state, e.manual, e.by]), [['foo.com', 'done', true, 'kim@foo.com'], ['addr:lee@krs.co.kr', 'done', true, ''], ['bar.org', 'excluded', true, '']]);
  assert.equal(it.expect[1].doneAt, '2026-10-14T00:00:00Z', '회신 없이 완료로 표시하면 그때');
  assert.equal(it.status.done, true);
  it = setExpect(it, 'foo.com', 'open');
  it = applyReplies(it, [{ id: 'auto', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-13T00:00:00Z', kind: 'auto', score: 3, counted: false }]);
  assert.equal(it.expect[0].state, 'open', '이미 있던 센 회신으로는 수동 open 을 되돌리지 않는다');
});

console.log('수동 조작');
t('setExpect — done/open/excluded(manual), 상태 다시 셈; done 은 센 회신이 있으면 그 사람·때; 모르는 키·상태는 그대로', () => {
  let it = applyReplies(mkItem(), [{ id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true }]);
  it = setExpect(it, 'foo.com', 'open');
  assert.deepEqual([it.expect[0].state, it.expect[0].manual, it.expect[0].by, it.status.responded], ['open', true, '', 0]);
  it = setExpect(it, 'FOO.COM', 'done', { now: 0 });
  assert.deepEqual([it.expect[0].state, it.expect[0].by, it.expect[0].doneAt], ['done', 'kim@foo.com', '2026-10-11T00:00:00Z']);
  it = setExpect(it, 'bar.org', 'excluded');
  it = setExpect(it, 'addr:lee@krs.co.kr', 'excluded');
  assert.deepEqual(it.status, { expected: 1, responded: 1, excluded: 2, done: true });
  assert.deepEqual(setExpect(it, 'nope.com', 'done'), it);
  assert.deepEqual(setExpect(it, 'foo.com', 'weird'), it);
});
t("setExpect 'auto'(덧붙임) — 수동 표시를 풀고 회신대로 다시 맞춘다", () => {
  let it = applyReplies(mkItem(), [{ id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true }]);
  it = setExpect(it, 'foo.com', 'excluded');
  it = setExpect(it, 'foo.com', 'auto');
  assert.deepEqual([it.expect[0].state, it.expect[0].manual, it.expect[0].by], ['done', false, 'kim@foo.com']);
  it = setExpect(setExpect(it, 'bar.org', 'done'), 'bar.org', 'auto');
  assert.deepEqual([it.expect[2].state, it.expect[2].manual], ['open', false]);
});
t('linkReply — 후보를 키에 이으면 세고 reply 가 되며 키가 done; 모르는 키·없는 회신은 그대로', () => {
  let it = mkItem();
  it = applyReplies(it, matchAll([mail('c1', 'park@bar.org', { subject: '실적 자료 요청 건 질문' })], [it], { me: ME }).linked.map((l) => l.reply));
  assert.deepEqual([it.replies[0].kind, it.expect[2].state], ['candidate', 'open']);
  const x = linkReply(it, 'c1', 'bar.org');
  assert.deepEqual([x.replies[0].kind, x.replies[0].key, x.replies[0].counted, x.replies[0].manual], ['reply', 'bar.org', true, true]);
  assert.deepEqual([x.expect[2].state, x.expect[2].by, x.status.responded], ['done', 'park@bar.org', 1]);
  assert.deepEqual(linkReply(it, 'c1', 'nope.com'), it);
  assert.deepEqual(linkReply(it, 'zz', 'bar.org'), it);
  const y = linkReply(setExpect(it, 'bar.org', 'open'), 'c1', 'bar.org');
  assert.equal(y.expect[2].state, 'done', '사람이 이은 것은 수동 open 키도 채운다');
});
t('unlinkReply — 회신은 남고 키·세기만 지운다; 그 키의 유일한 센 회신이면 수동 아닌 키는 다시 open, 수동 done 은 그대로', () => {
  let it = applyReplies(mkItem(), [
    { id: 'r1', from: A('kim@foo.com'), key: 'foo.com', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true },
    { id: 'r2', from: A('park@bar.org'), key: 'bar.org', receivedAt: '2026-10-11T00:00:00Z', kind: 'reply', score: 3, counted: true },
    { id: 'r3', from: A('choi@bar.org'), key: 'bar.org', receivedAt: '2026-10-12T00:00:00Z', kind: 'reply', score: 3, counted: true },
  ]);
  it = unlinkReply(it, 'r1');
  assert.deepEqual([it.replies.length, it.replies[0].key, it.replies[0].counted, it.replies[0].manual], [3, null, false, true]);
  assert.deepEqual([it.expect[0].state, it.expect[0].by, it.expect[0].doneAt], ['open', '', '']);
  it = unlinkReply(it, 'r2');
  assert.deepEqual([it.expect[2].state, it.expect[2].by], ['done', 'choi@bar.org'], '남은 센 회신이 있으면 그대로(그 사람으로)');
  it = setExpect(it, 'bar.org', 'done');
  it = unlinkReply(it, 'r3');
  assert.equal(it.expect[2].state, 'done', '수동 done 은 내려가지 않는다');
  assert.deepEqual(unlinkReply(it, 'zz'), it);
});
t('setCounted — 자동 회신을 "세기" 하면 보낸 사람으로 키를 찾아 done, "빼기" 하면 다시 open; 후보를 세면 reply', () => {
  let it = mkItem();
  it = applyReplies(it, matchAll([
    mail('auto', 'lee@krs.co.kr', { subject: '자동 회신: 실적 자료 요청', conversationId: 'conv-sent-1' }),
    mail('cand', 'park@bar.org', { subject: '실적 자료 요청 건 질문' }),
    mail('ndr', 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@krs.co.kr', { subject: '배달 못 함: 실적 자료 요청', conversationId: 'conv-sent-1' }),
  ], [it], { me: ME }).linked.map((l) => l.reply));
  it = setCounted(it, 'auto', true);
  assert.deepEqual([it.replies[0].kind, it.replies[0].counted, it.replies[0].manual, it.expect[1].state], ['auto', true, true, 'done']);
  it = setCounted(it, 'auto', false);
  assert.deepEqual([it.replies[0].counted, it.replies[0].key, it.expect[1].state], [false, 'addr:lee@krs.co.kr', 'open'], '키는 남기고 세기만 뺀다');
  it = setCounted(it, 'cand', true);
  assert.deepEqual([it.replies[1].kind, it.expect[2].state], ['reply', 'done']);
  it = setCounted(it, 'ndr', true);
  assert.deepEqual([it.replies[2].counted, it.replies[2].key], [true, null], '키를 못 찾으면 세도 채우는 키가 없다');
  assert.deepEqual(it.status, { expected: 3, responded: 1, excluded: 0, done: false });
  assert.deepEqual(it.replies.map((r) => r.review), ['rejected', 'accepted', 'accepted'], '세기/빼기는 수락/거부와 같다');
});

console.log('확인(수락·거부)');
t('matchAll — 새 회신은 review pending; autoCount:false(설정 requireAccept) 면 사람의 답도 세지 않는다', () => {
  const it = mkItem();
  const mails = [mail('r-kim', A('kim@foo.com', '김'), { conversationId: 'conv-sent-1' }), mail('r-auto', 'lee@krs.co.kr', { subject: '자동 회신: 실적 자료 요청', conversationId: 'conv-sent-1' })];
  const on = matchAll(mails, [it], { me: ME }).linked.map((l) => [l.reply.id, l.reply.counted, l.reply.review, l.reply.reviewedAt]);
  assert.deepEqual(on, [['r-kim', true, 'pending', ''], ['r-auto', false, 'pending', '']]);
  const off = matchAll(mails, [it], { me: ME, autoCount: false }).linked.map((l) => [l.reply.id, l.reply.kind, l.reply.counted, l.reply.review]);
  assert.deepEqual(off, [['r-kim', 'reply', false, 'pending'], ['r-auto', 'auto', false, 'pending']], '갈래는 그대로, 세지만 않는다');
  const x = applyReplies(it, matchAll(mails, [it], { me: ME, autoCount: false }).linked.map((l) => l.reply));
  assert.deepEqual([x.expect[0].state, x.status.responded], ['open', 0], '수락 전에는 받을 곳이 기다림');
});
t('setReview — 수락은 세고(키 없으면 보낸 사람으로, 후보는 reply 로) 받을 곳 완료, 거부는 세지 않고 키는 남기며 받을 곳은 다시 기다림; reviewedAt 은 now; 모르는 상태·pending·없는 회신은 그대로', () => {
  let it = applyReplies(mkItem(), matchAll([
    mail('r-kim', A('kim@foo.com', '김'), { conversationId: 'conv-sent-1' }),
    mail('cand', 'park@bar.org', { subject: '실적 자료 요청 건 질문' }),
    mail('auto', 'lee@krs.co.kr', { subject: '자동 회신: 실적 자료 요청', conversationId: 'conv-sent-1' }),
  ], [mkItem()], { me: ME }).linked.map((l) => l.reply));
  const NOW = Date.parse('2026-10-15T05:00:00Z');
  it = setReview(it, 'r-kim', 'rejected', { now: NOW });
  const kim = it.replies.find((r) => r.id === 'r-kim');
  assert.deepEqual([kim.review, kim.reviewedAt, kim.counted, kim.manual, kim.key, it.expect[0].state, it.expect[0].by], ['rejected', '2026-10-15T05:00:00Z', false, true, 'foo.com', 'open', '']);
  it = setReview(it, 'r-kim', 'accepted', { now: NOW + MIN });
  assert.deepEqual([it.replies[0].review, it.replies[0].reviewedAt, it.replies[0].counted, it.expect[0].state, it.expect[0].by], ['accepted', '2026-10-15T05:01:00Z', true, 'done', 'kim@foo.com']);
  it = setReview(it, 'cand', 'accepted');
  assert.deepEqual([it.replies[1].kind, it.replies[1].review, it.replies[1].reviewedAt, it.expect[2].state], ['reply', 'accepted', '', 'done'], '후보를 수락하면 reply, now 가 없으면 reviewedAt 은 빈 글');
  it = setReview(it, 'auto', 'accepted');
  assert.deepEqual([it.replies[2].kind, it.replies[2].counted, it.expect[1].state], ['auto', true, 'done'], '자동 회신도 수락하면 그 사람의 받을 곳이 완료');
  assert.deepEqual(it.status, { expected: 3, responded: 3, excluded: 0, done: true });
  assert.deepEqual(setReview(it, 'auto', 'pending'), it, 'pending 으로는 되돌리지 않는다(수락/거부로만 바꾼다)');
  assert.deepEqual(setReview(it, 'auto', 'nope'), it);
  assert.deepEqual(setReview(it, 'zz', 'accepted'), it);
  // 갱신이 같은 메일을 다시 내밀어도(이미 있는 id) 거부가 남는다.
  it = setReview(it, 'r-kim', 'rejected');
  const again = applyReplies(it, [{ ...it.replies[0], counted: true, manual: false, review: 'pending' }]);
  assert.deepEqual([again.replies[0].review, again.replies[0].counted, again.expect[0].state], ['rejected', false, 'open']);
});
t('linkReply — 사람이 이은 회신은 수락(reviewedAt 은 now)', () => {
  let it = applyReplies(mkItem(), [{ id: 'c', from: A('park@bar.org'), key: 'bar.org', receivedAt: '2026-10-11T00:00:00Z', kind: 'candidate', score: 1, counted: false }]);
  assert.equal(it.replies[0].review, 'pending');
  it = linkReply(it, 'c', 'bar.org', { now: Date.parse('2026-10-15T05:00:00Z') });
  assert.deepEqual([it.replies[0].review, it.replies[0].reviewedAt, it.replies[0].counted, it.expect[2].state], ['accepted', '2026-10-15T05:00:00Z', true, 'done']);
});

console.log(`\n${pass} passed`);
