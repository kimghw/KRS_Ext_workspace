// 메일 수신(회신 추적)의 금고 — 등록한 보낸 메일과 이어진 회신의 본문(HTML·글)과 첨부 바이트를 한 곳에 둔다.
//
// 2026-10-15 사용자 지정: "메일 내용과 첨부파일을 한 곳에 관리해 줍니다. docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지".
// 병합(ooxml/merge.js)은 내가 보낸 양식의 바이트와 회신 첨부의 바이트를 여기서 꺼낸다. 바이트가 커서 chrome.storage(장부, store/book.js)가 아니라
// IndexedDB 에 둔다 — 확장의 출처에 하나, 패널을 닫아도 남는다.
//
// **DB 는 따로 연다(krsMailtrack).** 증빙 보관함(src/evidence.js)의 krsWorkspace 는 v1 에 스토어가 하나뿐이라, 거기에 스토어를 더하려면 버전을
// 올려야 하고 그러면 그 파일이 여는 v1 이 VersionError 로 깨진다. 그래서 이 파일은 krsWorkspace 를 절대 열지 않는다.
//
//   bodies  키 `${itemId}\u0001${messageId}`                   값 { itemId, messageId, subject, from, receivedAt, contentType, content, savedAt }
//   files   키 `${itemId}\u0001${messageId}\u0001${attachmentId}` 값 { itemId, messageId, attachmentId, name, contentType, size, bytes: Uint8Array, savedAt }
//   둘 다 index `itemId` — 등록 항목 하나의 것을 한 번에 꺼내고 지운다. itemId 는 보낸 메일의 messageId(장부의 TrackedItem.id).
//
//   import { createVault } from './store/vault.js';
//   const vault = createVault();                       // 아무것도 열지 않는다 — 처음 부를 때 IndexedDB 를 연다
//   await vault.putFile({ itemId, messageId, attachmentId, name, contentType, size, bytes });
//   const files = await vault.files(itemId);           // 병합·zip 이 쓴다
//
// import·생성만으로는 indexedDB 를 건드리지 않는다(test/wiring.test.mjs 는 indexedDB 가 없는 jsdom 에서 sidepanel.js 를 통째로 import 한다).

/** 금고의 IndexedDB 이름·버전·스토어 이름. 스토어를 더할 일이 생기면 VAULT_VERSION 을 올리고 upgradeVault 에 갈래를 더한다. */
export const VAULT_DB = 'krsMailtrack';
export const VAULT_VERSION = 1;
export const BODIES = 'bodies';
export const FILES = 'files';
export const ITEM_INDEX = 'itemId';

/** 키를 잇는 글자. 메일 ID(Graph id 는 base64 꼴 — '/'·'+'·'=' 가 들어 있다)에 나오지 않는 제어 문자를 쓴다. */
const SEP = '\u0001';
export const bodyKey = (itemId, messageId) => `${itemId}${SEP}${messageId}`;
export const fileKey = (itemId, messageId, attachmentId) => `${itemId}${SEP}${messageId}${SEP}${attachmentId}`;

/**
 * 스토어 만들기(onupgradeneeded). 키는 값 밖에 둔다(out-of-line) — 값에 키 칸을 따로 두지 않으려고. 이미 있는 것은 건드리지 않는다.
 * @param {IDBDatabase} db
 * @param {number} oldVersion 0 이면 처음 만드는 것
 */
export function upgradeVault(db, oldVersion = 0) {
  if (oldVersion < 1) {
    for (const name of [BODIES, FILES]) {
      if (db.objectStoreNames.contains(name)) continue;
      db.createObjectStore(name).createIndex(ITEM_INDEX, 'itemId', { unique: false });
    }
  }
}

/**
 * IndexedDB 뒷단. 부를 때마다 열고 닫는다 — 드물게 쓰이고, 열어 둔 채 두면 다른 창의 패널이 버전을 올릴 때 걸린다(src/evidence.js 와 같은 방식).
 * IndexedDB 가 없는 환경이면 만들 때가 아니라 쓸 때 한국어 오류로 거절한다 — 부르는 쪽(sync·패널)이 잡아 "금고에 담지 못했다"고 말한다.
 * @param {{idb?: IDBFactory}} [opts]
 */
export function idbBackend({ idb = globalThis.indexedDB } = {}) {
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('이 환경에는 메일 금고(IndexedDB)가 없습니다.')); return; }
    let req;
    try { req = idb.open(VAULT_DB, VAULT_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = (ev) => upgradeVault(req.result, ev?.oldVersion || 0);
    req.onsuccess = () => {
      const db = req.result;
      // 다른 창이 버전을 올리려 하면 비켜 준다 — 쥐고 있으면 그쪽이 막힌다.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('메일 금고를 열지 못했습니다.'));
  });
  /** 트랜잭션 하나. work(tx, set) 안에서 요청을 걸고, set 으로 남긴 값이 트랜잭션이 끝난(complete) 뒤에 돌아온다. */
  const run = async (names, mode, work) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction(names, mode);
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('메일 금고에 쓰지 못했습니다.'));
        try {
          work(tx, (v) => { result = v; });
        } catch (e) {
          try { tx.abort(); } catch { /* 이미 끝난 트랜잭션 */ }
          reject(e);
        }
      });
    } finally {
      db.close();
    }
  };
  const ask = (tx, store, make, set, map = (x) => x) => {
    const req = make(tx.objectStore(store));
    req.onsuccess = () => set(map(req.result));
  };
  return {
    put: (store, key, value) => run(store, 'readwrite', (tx) => { tx.objectStore(store).put(value, key); }),
    get: (store, key) => run(store, 'readonly', (tx, set) => ask(tx, store, (s) => s.get(key), set, (v) => v ?? null)),
    byItem: (store, itemId) => run(store, 'readonly', (tx, set) => ask(tx, store, (s) => s.index(ITEM_INDEX).getAll(itemId), set, (v) => v || [])),
    /** 등록 항목 하나의 것을 두 스토어에서 한 트랜잭션으로 지운다. 지운 수를 돌려준다. */
    removeItem: (itemId) => run([BODIES, FILES], 'readwrite', (tx, set) => {
      const counts = { [BODIES]: 0, [FILES]: 0 };
      set(counts);
      for (const name of [BODIES, FILES]) {
        const s = tx.objectStore(name);
        const req = s.index(ITEM_INDEX).getAllKeys(itemId);
        req.onsuccess = () => {
          for (const k of req.result || []) s.delete(k);
          counts[name] = (req.result || []).length;
        };
      }
    }),
    /** 스토어의 값을 하나씩 본다(커서) — 한꺼번에 읽으면(getAll) 첨부 바이트가 한 번에 다 올라온다. */
    scan: (store, visit) => run(store, 'readonly', (tx) => {
      const req = tx.objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        visit(cur.value);
        cur.continue();
      };
    }),
  };
}

/** 메모리 뒷단 — 시험과 IndexedDB 가 없는 곳에서. 넣고 꺼낼 때 복사한다(IndexedDB 의 structured clone 과 같게 — 꺼낸 것을 고쳐도 담긴 것은 그대로). */
export function memoryBackend() {
  const data = { [BODIES]: new Map(), [FILES]: new Map() };
  const of = (store) => {
    const m = data[store];
    if (!m) throw new Error(`메일 금고에 '${store}' 칸이 없습니다.`);
    return m;
  };
  return {
    data,
    put: async (store, key, value) => { of(store).set(key, structuredClone(value)); },
    get: async (store, key) => (of(store).has(key) ? structuredClone(of(store).get(key)) : null),
    byItem: async (store, itemId) => [...of(store).values()].filter((v) => v.itemId === itemId).map((v) => structuredClone(v)),
    removeItem: async (itemId) => {
      const counts = {};
      for (const name of [BODIES, FILES]) {
        counts[name] = 0;
        for (const [k, v] of [...of(name)]) if (v.itemId === itemId) { of(name).delete(k); counts[name]++; }
      }
      return counts;
    },
    scan: async (store, visit) => { for (const v of of(store).values()) visit(v); },
  };
}

/* ------------------------------------------------------------ 값 다듬기 */

const tag = (x) => Object.prototype.toString.call(x);

/**
 * 바이트를 딱 맞는 Uint8Array 로. 큰 버퍼의 한 조각(subarray)을 그대로 담으면 structured clone 이 버퍼 전체를 담는다 — 그래서 조각이면 복사한다.
 * Uint8Array·ArrayBuffer·다른 TypedArray/DataView·숫자 배열을 받는다(다른 realm — jsdom — 의 것도). 그 밖은 null.
 */
export function toBytes(x) {
  if (x == null) return null;
  if (tag(x) === '[object ArrayBuffer]') return new Uint8Array(x.slice(0));
  if (ArrayBuffer.isView(x)) {
    const view = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return x.byteOffset === 0 && x.byteLength === x.buffer.byteLength && tag(x) === '[object Uint8Array]' ? x : view.slice();
  }
  if (Array.isArray(x)) return Uint8Array.from(x);
  return null;
}

/** 꺼낸 바이트는 언제나 Uint8Array. (옛 값이 ArrayBuffer 로 담겼어도.) */
const asU8 = (x) => {
  if (tag(x) === '[object Uint8Array]') return x;
  return toBytes(x) || new Uint8Array(0);
};

const str = (x) => (x == null ? '' : String(x));
const need = (rec, names, what) => {
  for (const n of names) if (!str(rec?.[n])) throw new Error(`메일 금고에 담을 ${what}에 ${n} 가 없습니다.`);
};
const addrOf = (a) => (a && typeof a === 'object' ? { name: str(a.name), address: str(a.address) } : null);
const byOrder = (...keys) => (a, b) => {
  for (const k of keys) {
    const x = a[k] ?? '', y = b[k] ?? '';
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};
/** 글자를 UTF-8 로 쓸 때의 바이트 수 — 쓰는 양을 말할 때만 쓴다. */
const utf8Length = (s) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
};

/**
 * 금고. 뒷단을 주지 않으면 처음 부를 때 idbBackend() 를 만든다(그때 globalThis.indexedDB 를 본다).
 * @param {object} [backend] idbBackend() · memoryBackend() · 같은 꼴의 가짜
 * @param {{now?: () => number}} [opts] savedAt 시계(시험용)
 */
export function createVault(backend, { now = () => Date.now() } = {}) {
  let be = backend || null;
  const B = () => (be ||= idbBackend());
  const call = async (fn) => fn(B());

  return {
    /** 메일 하나의 본문. 같은 (itemId, messageId) 에 다시 담으면 새것으로 바뀐다. 담은 값을 돌려준다. */
    async putBody(rec) {
      need(rec, ['itemId', 'messageId'], '본문');
      const value = {
        itemId: str(rec.itemId), messageId: str(rec.messageId), subject: str(rec.subject), from: addrOf(rec.from),
        receivedAt: str(rec.receivedAt), contentType: rec.contentType === 'html' ? 'html' : 'text', content: str(rec.content),
        savedAt: Number.isFinite(rec.savedAt) ? rec.savedAt : now(),
      };
      await call((b) => b.put(BODIES, bodyKey(value.itemId, value.messageId), value));
      return value;
    },
    /** 없으면 null. */
    getBody: (itemId, messageId) => call((b) => b.get(BODIES, bodyKey(itemId, messageId))),
    /** 등록 항목 하나의 본문들 — 받은 차례(receivedAt)대로. */
    async bodies(itemId) {
      return (await call((b) => b.byItem(BODIES, itemId))).sort(byOrder('receivedAt', 'savedAt', 'messageId'));
    },
    /** 첨부 하나. bytes 는 Uint8Array(ArrayBuffer·조각도 받아 딱 맞게 복사해 담는다). 담은 값(바이트 포함)을 돌려준다. */
    async putFile(rec) {
      need(rec, ['itemId', 'messageId', 'attachmentId'], '첨부');
      const bytes = toBytes(rec.bytes);
      if (!bytes) throw new Error(`메일 금고에 담을 첨부(${str(rec.name) || rec.attachmentId})에 바이트가 없습니다.`);
      const value = {
        itemId: str(rec.itemId), messageId: str(rec.messageId), attachmentId: str(rec.attachmentId), name: str(rec.name),
        contentType: str(rec.contentType) || 'application/octet-stream',
        size: Number.isFinite(rec.size) ? rec.size : bytes.byteLength, bytes,
        savedAt: Number.isFinite(rec.savedAt) ? rec.savedAt : now(),
      };
      await call((b) => b.put(FILES, fileKey(value.itemId, value.messageId, value.attachmentId), value));
      return value;
    },
    /** 없으면 null. bytes 는 Uint8Array. */
    async getFile(itemId, messageId, attachmentId) {
      const v = await call((b) => b.get(FILES, fileKey(itemId, messageId, attachmentId)));
      return v ? { ...v, bytes: asU8(v.bytes) } : null;
    },
    /** 등록 항목 하나의 첨부들(바이트 포함) — 담은 차례대로, 같으면 메일·이름 차례. */
    async files(itemId) {
      return (await call((b) => b.byItem(FILES, itemId)))
        .map((v) => ({ ...v, bytes: asU8(v.bytes) }))
        .sort(byOrder('savedAt', 'messageId', 'name', 'attachmentId'));
    },
    /** 등록 항목을 지울 때 그 본문·첨부를 다 지운다. → { bodies: 지운 수, files: 지운 수 } */
    removeItem: (itemId) => call((b) => b.removeItem(itemId)),
    /** 얼마나 담겼는지 — 설정 칸에 보인다. bytes 는 본문 글자(UTF-8)와 첨부 바이트를 더한 것. */
    async usage() {
      const out = { bodies: 0, files: 0, bytes: 0 };
      await call(async (b) => {
        await b.scan(BODIES, (v) => { out.bodies++; out.bytes += utf8Length(str(v?.content)); });
        await b.scan(FILES, (v) => { out.files++; out.bytes += v?.bytes?.byteLength || 0; });
      });
      return out;
    },
  };
}
