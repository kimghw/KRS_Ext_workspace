// 코레일이 공개한 XLSX 시간표를 읽고, 운행 요일·정차역·시각으로 조회한다.
// 조회는 메모리 안에서 끝난다. 매진·좌석·예약 화면은 읽지 않는다.
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key];
});
const elements = (xml, name) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>)`, 'g'))];
const attr = (text, name) => decode(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`).exec(text)?.[1] || '');
const textOf = (xml) => elements(xml, 't').map((m) => decode(m[2] || '')).join('');
const column = (reference) => [...reference.replace(/\d/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const stationName = (name) => ({ 울산: '울산(통도사)', 여수엑스포: '여수EXPO' })[name] || name.replace(/\s/g, '');
const WEEK = '일월화수목금토';

/** Fail on unknown operating-day notes instead of silently treating a train as daily. */
export function operatingDays(note) {
  const value = note.replace(/[\s,·]/g, '');
  if (value === '매일') return 127;
  if (!/^[월화수목금토일]+$/.test(value)) throw new Error(`알 수 없는 운행 요일: ${note}`);
  return [...value].reduce((mask, day) => mask | (1 << WEEK.indexOf(day)), 0);
}

/** Shared by the import tool and the optional future data refresh; no Python dependency. */
export async function readKorailTimetable(bytes) {
  const { unzipEntries } = await import('./officetext.js');
  const zip = await unzipEntries(bytes, { want: /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/ });
  const xml = (path) => new TextDecoder().decode(zip.get(path) || new Uint8Array());
  const shared = elements(xml('xl/sharedStrings.xml'), 'si').map((m) => textOf(m[2] || ''));
  const rels = new Map(elements(xml('xl/_rels/workbook.xml.rels'), 'Relationship').map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const trains = [], seen = new Set();
  for (const sheet of elements(xml('xl/workbook.xml'), 'sheet')) {
    if (attr(sheet[1], 'state') === 'hidden') continue;
    const target = rels.get(attr(sheet[1], 'r:id'));
    if (!target || target.includes('..')) throw new Error('시간표 시트 경로가 올바르지 않습니다.');
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    let blocks = [];
    for (const row of elements(xml(path), 'row')) {
      if (attr(row[1], 'hidden') === '1') continue;
      const cells = new Map();
      for (const cell of elements(row[2] || '', 'c')) {
        const raw = elements(cell[2] || '', 'v')[0]?.[2] ?? '';
        const type = attr(cell[1], 't');
        const value = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? textOf(cell[2] || '') : decode(raw);
        cells.set(column(attr(cell[1], 'r')), value || '');
      }
      if ([...cells.values()].includes('열차번호')) {
        blocks = [];
        for (const [start, name] of cells) {
          if (name !== '열차번호') continue;
          const end = [...cells].find(([col, value]) => col > start && value.startsWith('비고'))?.[0];
          if (!end || cells.get(start + 1) !== '편성') throw new Error(`코레일 시간표의 표 구조가 바뀌었습니다: ${attr(sheet[1], 'name')} ${start} ${cells.get(start + 1)} ${end}`);
          const stops = [...cells].filter(([col]) => col > start + 1 && col < end).map(([col, value]) => [col, stationName(value)]);
          blocks.push({ start, end, stops });
        }
        continue;
      }
      for (const block of blocks) {
        const no = cells.get(block.start), type = cells.get(block.start + 1) || '';
        if (!/^\d+$/.test(no || '') || !type.startsWith('KTX')) continue;
        let previous = -1, day = 0;
        const stops = [];
        for (const [col, name] of block.stops) {
          const raw = cells.get(col);
          if (raw == null || raw === '' || raw === '0') continue;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0 || n >= 2) throw new Error(`알 수 없는 열차 시각: ${no} ${name} ${raw}`);
          const minute = Math.floor((Math.round(n * 86400) + 0.001) / 60);
          if (minute % 1440 < previous % 1440) day += 1440;
          const absolute = minute % 1440 + day;
          stops.push([name, absolute]);
          previous = absolute;
        }
        if (stops.length < 2) continue;
        const train = { no: no.padStart(3, '0'), train: type.replace(/^KTX[_-]?산천$/, 'KTX-산천'), days: operatingDays(cells.get(block.end) || ''), stops };
        const key = JSON.stringify(train);
        if (!seen.has(key)) { seen.add(key); trains.push(train); }
      }
    }
  }
  if (trains.length < 1) throw new Error('코레일 시간표에서 열차를 읽지 못했습니다.');
  return trains;
}

const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** date is the boarding date, including stops after midnight on a previous day's train. */
export function timetableRows(table, { from, to, date, hour }) {
  const requestedDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  const rows = [], seen = new Set();
  for (const train of table.trains) {
    const begin = train.stops.findIndex(([name]) => name === from);
    const end = train.stops.findIndex(([name], i) => i > begin && name === to);
    if (begin < 0 || end < 0) continue;
    const dep = train.stops[begin][1], arr = train.stops[end][1];
    const originDay = (requestedDay - Math.floor(dep / 1440) + 7) % 7;
    if (!(train.days & (1 << originDay)) || dep % 1440 < hour * 60 || arr <= dep) continue;
    const key = `${train.no}/${dep}/${arr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const took = arr - dep, h = Math.floor(took / 60), m = took % 60;
    rows.push({ train: train.train, no: train.no, dep: clock(dep), arr: clock(arr),
      took: `${h ? `${h}시간` : ''}${h && m ? ' ' : ''}${m ? `${m}분` : ''}`,
      nextDay: Math.floor(arr / 1440) > Math.floor(dep / 1440) });
  }
  return rows.sort((a, b) => a.dep.localeCompare(b.dep) || a.arr.localeCompare(b.arr) || a.no.localeCompare(b.no));
}
