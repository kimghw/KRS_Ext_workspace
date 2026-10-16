// 설정 → LLM 갈래의 "다리가 하는 일" 표 — 로컬 Claude CLI 다리(네이티브 메시징, native/host.mjs)가 패널에서 무엇에 쓰이는지,
// 다리가 없을 때 그 일이 어디로 가는지(API 키 · 브라우저 · 없음)를 한 줄씩 적는다. 사용자 지정(2026-10-16):
// "브릿지(로컬 Claude CLI 다리)를 사용하는 것은 설정에 뭐가 쓰는지 표기해줘".
//
// 순수 함수다 — DOM 도 storage 도 만지지 않는다. 그리는 쪽(sidepanel.js paintBridgeUses)이 state 를 넣고 줄을 받아 그린다.
// 줄의 상태 셋:
//  - on  다리가 맡는다.
//  - alt 다리 없이 다른 길로 간다(API 키 · 확장 안의 브라우저 엔진). 되기는 되지만 다리와 같지는 않다.
//  - off 그 일을 못 한다(또는 덜 한 채로 간다 — 첨부를 파일째 보내는 것처럼).
// 네 줄의 차례는 고정이다 — 가장 자주 쓰는 Claude 호출이 맨 위, 다리만 하는 일(GitHub·다리 기록)이 아래.

const row = (id, label, via, state) => ({ id, label, via, state });

/**
 * @param {{ cli?: boolean, apiKey?: string, docText?: { ok?: boolean, reason?: string } | null }} [opts]
 *   cli — 다리가 닿는가(sidepanel.js state.cli) · apiKey — 저장된 Anthropic API 키 · docText — 브라우저 글자 뽑기 꾸러미가 있는가
 *   (doctext/browser.js ready() 의 { ok, reason }). 빠진 값은 전부 "없음" 으로 본다.
 * @returns {{ id: string, label: string, via: string, state: 'on'|'alt'|'off' }[]}
 */
export function bridgeUses({ cli = false, apiKey = '', docText = { ok: false, reason: '' } } = {}) {
  const key = !!String(apiKey || '').trim();   // 빈 칸·공백만 넣은 키는 없는 것
  const doc = docText || {};
  return [
    cli ? row('claude', LABEL.claude, '다리(로컬 CLI)', 'on')
      : key ? row('claude', LABEL.claude, 'API 키', 'alt')
        : row('claude', LABEL.claude, '없음 — 규칙 해석만', 'off'),
    cli ? row('doctext', LABEL.doctext, '다리(node 의 pdf.js·Tesseract)', 'on')
      : doc.ok ? row('doctext', LABEL.doctext, '브라우저(확장 안의 pdf.js·Tesseract)', 'alt')
        : row('doctext', LABEL.doctext, `파일째 보냄 — ${doc.reason || '꾸러미 없음'}`, 'off'),
    cli ? row('git', LABEL.git, '다리', 'on') : row('git', LABEL.git, '없음 — 아이콘 숨김', 'off'),
    cli ? row('logs', LABEL.logs, '다리', 'on') : row('logs', LABEL.logs, '없음', 'off'),
  ];
}

/** 줄마다 하는 일의 이름. 패널 곳곳의 문구(말로 찾기 · 말로 채우기 · 증빙 · 공문 읽기 …)와 같은 말을 쓴다. */
const LABEL = {
  claude: 'Claude 호출(말로 찾기·근태 말로 채우기·증빙·공문 읽기·사유 쓰기·실패 진단)',
  doctext: '첨부 글자 먼저 뽑기(PDF 글자 층·OCR)',
  git: 'GitHub 새 커밋 확인·받기(패널 머리 아이콘)',
  logs: '활동 로그에 다리 기록(native\\logs) 담기',
};
