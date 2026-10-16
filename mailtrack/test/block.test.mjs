// 메일 보안(block@krs.co.kr) 인증 요청 알림 풀기(mailtrack/block.js) — 알림 가리기·제목 꼬리 떼기·본문 표(HTML)와 글 본문 읽기·원 메일로 풀기·
// 본문을 받아 볼 알림 고르기, 그리고 푼 메일이 match.js 에서 점수 2 로 이어지는지. 본문 꼴은 2026-10-16 실제 알림의 표 모양을 따르되 주소는 가짜다.
import assert from 'node:assert/strict';

import { BLOCK_FROM, isBlockFrom, isNotice, noticeSubject, mayMatch, parseNotice, unwrapNotice } from '../block.js';
import { newItem, normalizeReply } from '../model.js';
import { matchAll, scoreOf } from '../match.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ME = 'me@krs.co.kr';
const A = (address, name = '') => ({ name, address });
const TAIL = ' [인증 요청] 본 메일은 인증 요청 메일 입니다. [Certification request] This is an authentication request mail.';
const row = (k, v) => `<tr><td style="padding:4px">${k} </td><td style="padding:4px">${v} </td></tr>`;
/** 실제 알림과 같은 꼴의 본문 — Mail Information 표, Sender Information 표, 안내 문단. */
const noticeHtml = ({ subject, from, to = ME, date = '2026-10-16 11:23', envelope = from, header = '' }) => '<html><head><style>td{color:#333}</style></head><body>'
  + '<div>Secure Mail</div><div>인증이 필요한 메일입니다.</div><div>인증 만료 시간 : 2026-11-05 11:23</div>'
  + '<a href="http://block.example/mail/set_opt.php?id=X">[인증 차단]</a> <a href="http://block.example/mail/set_opt.php?id=X">[수신]</a>'
  + '<div><font>┃</font>Mail Information </div><table border="0"><colgroup><col width="120"><col width="*"></colgroup><tbody>'
  + row('Subject', subject) + row('From', from) + row('To', to) + row('Date', date)
  + '</tbody></table><div><font>┃</font>Sender Information </div><table border="0"><tbody>'
  + row('Envelope From', envelope) + row('Header From', header) + row('Sender IP', '192.0.2.1') + row('Sender Country', 'KR, South Korea')
  + '</tbody></table><div><font>·</font>인증 차단 : 인증 차단 필터에 발신자（' + from + '）가 등록되며 …</div></body></html>';

const SENT = {
  id: 's1', subject: '"Gangway Design" AIP 견적·계약서 송부', from: A(ME, '나'), to: [A('kim@foo.com', '김'), A('lee@krs.co.kr', '이')], cc: [],
  sentAt: '2026-10-15T01:00:00Z', conversationId: 'conv-s1', internetMessageId: '<s1@krs.co.kr>',
};
const ITEM = newItem(SENT, null, { me: ME, now: Date.parse('2026-10-15T02:00:00Z') });
const notice = (id, subject, extra = {}) => ({
  id, subject: subject + TAIL, from: A(BLOCK_FROM, BLOCK_FROM), sender: A(BLOCK_FROM, BLOCK_FROM), to: [A(ME)], cc: [], receivedAt: '2026-10-16T02:23:48Z',
  conversationId: 'conv-notice-' + id, internetMessageId: `<${id}@x>`, hasAttachments: false, isDraft: false, preview: 'Secure Mail 인증이 필요한 메일입니다.', webLink: 'https://outlook/' + id, ...extra,
});

console.log('알림 가리기');
t('isNotice — block@krs.co.kr 이 보낸 것 중 스팸 리포트가 아닌 것(제목 꼬리는 잘릴 수 있어 보지 않는다), 다른 주소는 아니다', () => {
  assert.equal(isNotice(notice('n1', 'RE: 견적')), true);
  assert.equal(isNotice({ ...notice('n2', '아주 긴 제목'), subject: '아주 긴 제목 [인증 요' }), true, '꼬리가 잘려도');
  assert.equal(isNotice({ ...notice('n3', ''), subject: '[AntiSpam] 스팸 리포트 (10/16자 01시)', from: A(BLOCK_FROM, 'Administrator') }), false);
  assert.equal(isBlockFrom({ from: A('BLOCK@KRS.CO.KR') }), true, '주소는 대소문자 무시');
  assert.equal(isNotice({ ...notice('n4', 'RE: 견적'), from: A('kim@foo.com') }), false);
});
t('noticeSubject — 꼬리 [인증 요청] … 를 떼고, 꼬리가 없으면 그대로', () => {
  assert.equal(noticeSubject(' Re: "Gangway" 송부' + TAIL), 'Re: "Gangway" 송부');
  assert.equal(noticeSubject('Re: 송부 [인증 요청] 본 메일은 인증 요청 메일 입니다. [Certification request] This is an authentication reques'), 'Re: 송부');
  assert.equal(noticeSubject('그냥 제목'), '그냥 제목');
});
t('mayMatch — 원 제목이 항목 제목과 같거나 품거나 잘린 앞머리일 때만 본문을 받는다', () => {
  assert.equal(mayMatch(notice('n1', 'Re: "Gangway Design" AIP 견적·계약서 송부'), [ITEM]), true);
  assert.equal(mayMatch(notice('n2', '[외부] FW: "Gangway Design" AIP 견적·계약서 송부 건 보완'), [ITEM]), true, '품음(점수 1 후보)');
  assert.equal(mayMatch({ ...notice('n3', ''), subject: 'RE: "Gangway Design" AIP 견' }, [ITEM]), true, '꼬리째 잘린 제목');
  assert.equal(mayMatch(notice('n4', 'Product Release Notes: Oct 13'), [ITEM]), false);
  assert.equal(mayMatch({ ...notice('n5', ''), subject: TAIL }, [ITEM]), false, '원 제목이 비면 받지 않는다');
  assert.equal(mayMatch(notice('n6', 'Re: 견적'), []), false);
});

console.log('본문 읽기');
t('parseNotice — HTML 표의 Subject·From·To·Date·Envelope From·Header From(글자 참조를 풀고 공백을 접음)', () => {
  const p = parseNotice({ contentType: 'html', content: noticeHtml({ subject: 'Re: &quot;Gangway Design&quot; AIP 견적·계약서 송부', from: 'kim@foo.com', header: '&quot;김철수 kim, chulsoo&quot;' }) });
  assert.deepEqual(p, { subject: 'Re: "Gangway Design" AIP 견적·계약서 송부', from: 'kim@foo.com', to: ME, date: '2026-10-16 11:23', envelopeFrom: 'kim@foo.com', headerFrom: '"김철수 kim, chulsoo"' });
});
t('parseNotice — 글 본문(이름 다음 줄의 값, 같은 줄의 값), From 이 없으면 Envelope From 으로, 둘 다 없으면 null', () => {
  const text = 'Secure Mail\r\n인증이 필요한 메일입니다.\r\n┃ Mail Information\r\nSubject\r\nRE: 견적 송부\r\nFrom\r\n\r\npark@bar.org\r\nTo: me@krs.co.kr\r\nDate 2026-10-16 10:27\r\n┃ Sender Information\r\nEnvelope From\r\npark@bar.org\r\nHeader From\r\n박 차장\r\n';
  assert.deepEqual(parseNotice({ contentType: 'text', content: text }), { subject: 'RE: 견적 송부', from: 'park@bar.org', to: ME, date: '2026-10-16 10:27', envelopeFrom: 'park@bar.org', headerFrom: '박 차장' });
  const envOnly = parseNotice(noticeHtml({ subject: 'RE: 견적', from: '', envelope: 'park@bar.org' }));
  assert.equal(envOnly.envelopeFrom, 'park@bar.org', 'contentType 이 없어도 표를 보면 HTML');
  assert.equal(parseNotice({ contentType: 'html', content: '<p>[AntiSpam] 스팸 리포트</p><table><tr><td>번호</td><td>1</td></tr></table>' }), null);
  assert.equal(parseNotice({ contentType: 'text', content: '' }), null);
  assert.equal(parseNotice(null), null);
});

console.log('풀기');
t('unwrapNotice — 보낸 사람(이름은 Header From)·제목·받는 사람은 본문에서, id·받은 때·대화 id·webLink 는 알림 것, via:block', () => {
  const n = notice('n1', 'Re: "Gangway Design" AIP 견적·계약서 송부');
  const m = unwrapNotice(n, { contentType: 'html', content: noticeHtml({ subject: 'Re: &quot;Gangway Design&quot; AIP 견적·계약서 송부', from: 'Kim@Foo.com', header: '&quot;김철수&quot;' }) });
  assert.deepEqual(m, { ...n, from: { name: '김철수', address: 'kim@foo.com' }, sender: null, subject: 'Re: "Gangway Design" AIP 견적·계약서 송부', to: [{ name: '', address: ME }], via: 'block' });
  const bare = unwrapNotice(n, noticeHtml({ subject: '', from: 'kim@foo.com', header: 'kim@foo.com', to: '' }));
  assert.deepEqual([bare.from, bare.subject, bare.to], [{ name: '', address: 'kim@foo.com' }, 'Re: "Gangway Design" AIP 견적·계약서 송부', [A(ME)]], '본문에 제목이 없으면 알림 제목에서 꼬리를 떼어, 이름이 주소뿐이면 빈 이름');
  assert.equal(unwrapNotice(n, { contentType: 'html', content: '<p>알림 꼴이 아님</p>' }), null);
});
t('푼 알림은 점수 2(머리표 뗀 제목 같음 + 받을 곳의 사람)로 이어져 센다, via 가 회신에 남는다 — 풀지 않은 알림은 0', () => {
  const n = notice('n1', 'Re: "Gangway Design" AIP 견적·계약서 송부');
  assert.equal(scoreOf(n, ITEM, { me: ME }), 0, 'block@krs.co.kr 은 받을 곳이 아니고 대화 id 도 다르다');
  const m = unwrapNotice(n, noticeHtml({ subject: 'Re: &quot;Gangway Design&quot; AIP 견적·계약서 송부', from: 'kim@foo.com', header: '김' }));
  assert.equal(scoreOf(m, ITEM, { me: ME }), 2);
  const { linked, unmatched } = matchAll([m], [ITEM], { me: ME });
  assert.equal(unmatched, 0);
  assert.deepEqual(linked.map((l) => [l.itemId, l.reply.id, l.reply.key, l.reply.kind, l.reply.counted, l.reply.via, l.reply.from.address]), [['s1', 'n1', 'foo.com', 'reply', true, 'block', 'kim@foo.com']]);
  const early = unwrapNotice({ ...n, receivedAt: '2026-10-14T00:00:00Z' }, noticeHtml({ subject: 'Re: 견적', from: 'kim@foo.com' }));
  assert.equal(scoreOf(early, ITEM, { me: ME }), 0, '보낸 때보다 먼저 받은 알림은 답이 아니다(알림의 Exchange 시각으로 가른다)');
});
t('normalizeReply — via 는 block 일 때만 칸이 선다(옛 회신 꼴은 그대로)', () => {
  assert.equal(normalizeReply({ id: 'r', via: 'block' }).via, 'block');
  assert.equal('via' in normalizeReply({ id: 'r' }), false);
  assert.equal('via' in normalizeReply({ id: 'r', via: 'other' }), false);
});

console.log(`\n${pass} passed`);
