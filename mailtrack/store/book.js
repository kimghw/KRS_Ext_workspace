// 메일 수신(회신 추적)의 장부 — 등록한 보낸 메일·기대 키(도메인/주소)·이어진 회신의 메타·상태(N/M)를 chrome.storage.local 한 키에 둔다.
//
// 2026-10-15 사용자 지정: "내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 … 같은 도메인 메일 수신이
// 보낸 거랑 같으면 완료 … 이 숫자를 관리". 그 숫자를 담는 곳이 여기다. 본문·첨부 바이트처럼 큰 것은 금고(store/vault.js, IndexedDB)에 둔다 —
// 장부는 패널을 열 때마다 통째로 읽고 쓰므로 작게 둔다.
//
// 장부의 꼴(Book)은 이 파일이 모른다 — 꼴 맞추기(normalize)는 조립하는 쪽(mailtrack/index.js)이 model.js 의 normalizeBook 을 넣어 준다.
// 이 파일은 읽기·쓰기와 **줄 세우기**만 한다: 패널의 단추(완료로 표시·세기)와 갱신(refresh)이 거의 같이 장부를 고칠 수 있는데,
// 둘이 각각 읽고-고치고-쓰면 나중에 쓴 쪽이 앞의 것을 지운다. update(fn) 는 promise 줄에 서서 하나씩 돈다.
//
//   import { createBook } from './store/book.js';
//   const book = createBook({ normalize: normalizeBook });
//   await book.update((b) => { b.items.push(item); });          // 고치거나, 새 장부를 돌려준다
//   const off = book.onChange((b) => render(b));                 // 다른 창의 패널이 고친 것도 따라간다
//
// chrome 은 처음 쓸 때 본다 — import·생성만으로는 건드리지 않는다(test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 import 한다).

/** 장부의 storage 키. model.js 의 BOOK_KEY 와 같은 값 — 서로 import 하지 않으려고(병렬 작업의 계약) 여기에도 둔다. */
export const BOOK_KEY = 'mailtrackBook';

/** 기본 저장소. 없으면 던진다 — 부르는 쪽(sync·패널)이 잡아 상태 줄에 말한다. */
function defaultStorage() {
  const local = globalThis.chrome?.storage?.local;
  if (!local) throw new Error('이 환경에는 확장 저장소(chrome.storage.local)가 없습니다.');
  return local;
}

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다. chrome 이 없으면 아무것도 듣지 않는다(src/people.js 와 같은 꼴). */
function defaultOnChanged(fn) {
  const ev = globalThis.chrome?.storage?.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 장부 하나. storage·onChanged 를 주면 그것을 쓴다(테스트는 가짜를 준다).
 * @param {object} [opts]
 * @param {{get: Function, set: Function}} [opts.storage] 기본 chrome.storage.local — 처음 쓸 때 본다
 * @param {string} [opts.key] storage 키(기본 'mailtrackBook')
 * @param {(raw: unknown) => object} [opts.normalize] 읽은 것·update 가 만든 것의 꼴을 맞춘다. 없는 장부(undefined)도 받는다
 * @param {(fn: (changes: object, area: string) => void) => (() => void)} [opts.onChanged] 기본 chrome.storage.onChanged
 * @param {string} [opts.area] 따라갈 storage 영역(기본 'local')
 * @returns {{ load: () => Promise<object>, save: (book: object) => Promise<object>, update: (fn: Function) => Promise<object>, onChange: (cb: Function) => (() => void) }}
 */
export function createBook({ storage, key = BOOK_KEY, normalize = (x) => x, onChanged, area = 'local' } = {}) {
  let store = storage || null;
  const local = () => (store ||= defaultStorage());

  const read = async () => {
    const got = await local().get(key);
    return got?.[key];
  };
  const write = async (book) => {
    await local().set({ [key]: book });
    return book;
  };

  // 줄: 고치는 일(update·save)은 앞의 것이 끝난 뒤에 돈다. 앞의 것이 실패해도 줄은 이어진다 — 실패는 그 일을 부른 쪽만 받는다.
  let tail = Promise.resolve();
  const enqueue = (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };

  /** 지금 장부(꼴 맞춘 것). 줄을 서지 않는다 — 고치는 중이면 고치기 전의 것을 받는다. */
  const load = async () => normalize(await read());

  return {
    load,
    /**
     * 장부를 그대로 쓴다(꼴 맞추기 없이). 앞서 부른 update 가 끝난 뒤에 쓴다.
     * 읽고-고쳐-쓰기는 update 로 할 것 — save 는 이미 다 만든 장부를 통째로 둘 때만.
     */
    save: (book) => enqueue(() => write(book)),
    /**
     * 읽고, fn 으로 고치고, 꼴 맞춰 쓰고, 쓴 것을 돌려준다. fn 은 async 여도 되고, 받은 장부를 고치기만 해도(돌려주는 것이 없으면 그것을 쓴다)
     * 새 장부를 돌려줘도 된다. 두 update 는 섞이지 않는다 — 나중 것은 앞의 것이 쓴 장부를 받는다.
     * fn 이 던지면 아무것도 쓰지 않고 그 update 만 실패한다.
     * fn 안에서 같은 장부의 save·update 를 부르지 말 것 — 자기 뒤에 줄을 서서 영영 끝나지 않는다.
     */
    update: (fn) => enqueue(async () => {
      const cur = await load();
      const out = await fn(cur);
      return write(normalize(out == null ? cur : out));
    }),
    /**
     * 장부가 바뀌면(이 창이든 다른 창의 패널이든) cb(꼴 맞춘 새 장부, 원래의 change)를 부른다. 돌려주는 함수로 그만 듣는다.
     * 들을 길(chrome.storage.onChanged·주입한 onChanged)이 없으면 아무것도 하지 않는 함수를 돌려준다.
     */
    onChange(cb) {
      const listen = onChanged || defaultOnChanged;
      const fn = (changes, where) => {
        if (where && where !== area) return;
        const ch = changes?.[key];
        if (!ch) return;
        cb(normalize(ch.newValue), ch);
      };
      return listen(fn) || (() => {});
    },
  };
}
