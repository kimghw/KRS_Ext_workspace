// 명시적인 "항목: 값" 입력은 모델을 기다리지 않고 같은 입력 명세로 검증한다.
// 한 줄이라도 모호하거나 지원하지 않는 요청이면 전체 요청을 기존 해석기로 보낸다.
import { fieldsFor } from './attend.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function explicitAttendFields(text, form) {
  const labels = new Map(fieldsFor(form).filter((f) => f.type === 'text' && ['place', 'venue', 'purpose'].includes(f.key)).map((f) => [f.label, f.key]));
  if ([...labels.values()].includes('place') && form.kind === 'trip') labels.set('행선지', 'place');
  if (!labels.size) return null;
  const start = new RegExp(`^(${[...labels.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?:[은는을를])?\\s*(?:[:：=]\\s*|\\s+)(.+)$`);
  const patch = {};
  for (const line of String(text || '').trim().split(/[\n;]+/)) {
    const match = line.trim().match(start);
    if (!match) return null;
    const key = labels.get(match[1]);
    if (key in patch) return null;
    let value = match[2].trim();
    const quoted = /^(?:"[\s\S]*"|'[\s\S]*')$/.test(value);
    if (quoted) value = value.slice(1, -1).trim();
    else if (/바꿔|변경해|채워|넣어|해\s*줘|해\s*주세요|아니라|말고|그리고/.test(value)) return null;
    if (!value || value.length > 200) return null;
    patch[key] = value;
  }
  return Object.keys(patch).length ? patch : null;
}
