// 메일 수신의 저장소 — 장부(store/book.js, chrome.storage.local 한 키)와 금고(store/vault.js, IndexedDB krsMailtrack).
// chrome.storage 와 IndexedDB 는 가짜로 바꿔 돌린다 — 진짜는 확장 안에서만 있다. 가짜 IndexedDB 는 이 파일 안의 작은 것(npm 의존 없음):
// 스토어·index·트랜잭션(요청이 다 끝나면 complete)·커서·버전 바꾸기만 흉내 낸다.
// 2026-10-15 사용자 지정: "메일 내용과 첨부파일을 한 곳에 관리해 줍니다" — 본문·첨부는 금고에, 숫자(N/M)는 장부에.
import assert from 'node:assert/strict';
import { createBook, BOOK_KEY } from '../store/book.js';
import {
  createVault, idbBackend, memoryBackend, upgradeVault, toBytes, bodyKey, fileKey,
  VAULT_DB, VAULT_VERSION, BODIES, FILES, ITEM_INDEX,
} from '../store/vault.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** chrome.storage.local 흉내 — get/set 이 한 박자씩 늦게 끝난다(줄을 세우지 않으면 두 update 가 섞이게). set 하면 onChanged 를 부른다. */
function fakeStorage(init = {}) {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, structuredClone(v)]));
  const listeners = new Set();
  const log = [];
  return {
    data, log, listeners,
    async get(key) {
      log.push(['get', key]);
      await sleep(1);
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(obj) {
      log.push(['set', ...Object.keys(obj)]);
      await sleep(1);
      for (const [k, v] of Object.entries(obj)) {
        const oldValue = data.get(k);
        data.set(k, structuredClone(v));
        for (const fn of listeners) fn({ [k]: { oldValue, newValue: structuredClone(v) } }, 'local');
      }
    },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  };
}
/** 장부 꼴 맞추기 흉내 — 없는 장부는 기본값, 있는 것에는 빠진 칸을 채운다(model.js 의 normalizeBook 자리). */
const normalize = (raw) => ({ v: 1, me: '', items: [], ...(raw && typeof raw === 'object' ? raw : {}), normalized: true });

console.log('장부(store/book.js)');
await ta('없는 장부를 읽으면 normalize 가 기본값을 준다 — 키는 mailtrackBook', async () => {
  assert.equal(BOOK_KEY, 'mailtrackBook');
  const st = fakeStorage();
  const book = createBook({ storage: st, normalize });
  assert.deepEqual(await book.load(), { v: 1, me: '', items: [], normalized: true });
  assert.deepEqual(st.log, [['get', 'mailtrackBook']]);
  assert.equal(await createBook({ storage: st }).load(), undefined, 'normalize 를 주지 않으면 읽은 그대로(없으면 undefined)');
});
await ta('save 는 그대로 쓰고 load 는 꼴 맞춰 읽는다 — key 를 바꾸면 그 키에', async () => {
  const st = fakeStorage();
  const book = createBook({ storage: st, normalize });
  const saved = await book.save({ v: 1, me: 'me@krs.co.kr', items: [{ id: 'A' }] });
  assert.deepEqual(saved, { v: 1, me: 'me@krs.co.kr', items: [{ id: 'A' }] }, 'save 는 쓴 것을 돌려준다');
  assert.deepEqual(st.data.get('mailtrackBook'), { v: 1, me: 'me@krs.co.kr', items: [{ id: 'A' }] }, 'save 는 normalize 하지 않는다');
  assert.deepEqual(await book.load(), { v: 1, me: 'me@krs.co.kr', items: [{ id: 'A' }], normalized: true });
  const other = createBook({ storage: st, key: 'mailtrackOther' });
  await other.save({ x: 1 });
  assert.deepEqual([st.data.get('mailtrackOther'), (await book.load()).x], [{ x: 1 }, undefined]);
});
await ta('update — 받은 장부를 고치기만 해도, 새 장부를 돌려줘도 된다. 쓴 것은 꼴 맞춘 것이다', async () => {
  const st = fakeStorage({ mailtrackBook: { v: 1, items: [] } });
  const book = createBook({ storage: st, normalize });
  const a = await book.update((b) => { b.items.push({ id: 'A' }); });
  assert.deepEqual(a, { v: 1, me: '', items: [{ id: 'A' }], normalized: true });
  assert.deepEqual(st.data.get('mailtrackBook'), a, '꼴 맞춘 것을 쓴다');
  const b = await book.update(async (cur) => { await sleep(2); return { me: 'me@krs.co.kr', items: [...cur.items, { id: 'B' }] }; });
  assert.deepEqual(b, { v: 1, me: 'me@krs.co.kr', items: [{ id: 'A' }, { id: 'B' }], normalized: true }, '돌려준 새 장부에 빠진 칸(v)을 normalize 가 채운다');
  assert.deepEqual(st.data.get('mailtrackBook'), b);
});
await ta('동시에 부른 update 는 줄을 선다 — 나중 것은 앞의 것이 쓴 장부를 받고, 어느 것도 지워지지 않는다', async () => {
  const st = fakeStorage({ mailtrackBook: { n: 0, seen: [] } });
  const book = createBook({ storage: st });
  const order = [];
  const p1 = book.update(async (b) => { order.push('1:start'); await sleep(20); b.n++; b.seen.push('1'); order.push('1:end'); });
  const p2 = book.update(async (b) => { order.push('2:start'); b.n++; b.seen.push('2'); order.push('2:end'); });
  const p3 = book.update((b) => { order.push('3:start'); b.n++; b.seen.push('3'); order.push('3:end'); });
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, ['1:start', '1:end', '2:start', '2:end', '3:start', '3:end']);
  assert.deepEqual([r1.n, r2.n, r3.n], [1, 2, 3]);
  assert.deepEqual(st.data.get('mailtrackBook'), { n: 3, seen: ['1', '2', '3'] });
  assert.deepEqual(st.log.map((x) => x[0]), ['get', 'set', 'get', 'set', 'get', 'set'], '읽기-쓰기가 짝지어 하나씩');
});
await ta('update 의 fn 이 던지면 그것만 실패하고 아무것도 쓰지 않는다 — 뒤의 update 는 그대로 돈다', async () => {
  const st = fakeStorage({ mailtrackBook: { n: 0 } });
  const book = createBook({ storage: st });
  const bad = book.update(async (b) => { b.n = 99; await sleep(5); throw new Error('고치다 실패'); });
  const badSync = book.update(() => { throw new Error('바로 실패'); });
  const good = book.update((b) => { b.n++; });
  await assert.rejects(bad, /고치다 실패/);
  await assert.rejects(badSync, /바로 실패/);
  assert.deepEqual(await good, { n: 1 }, '실패한 fn 이 고친 99 는 쓰이지 않았다');
  assert.deepEqual(st.log.filter((x) => x[0] === 'set').length, 1);
  assert.deepEqual(await book.update((b) => { b.n++; }), { n: 2 }, '그 뒤에도 줄이 막히지 않는다');
});
await ta('save 도 줄을 선다 — 앞서 부른 update 가 끝난 뒤에 쓰고, 그 뒤의 update 는 save 한 것을 받는다', async () => {
  const st = fakeStorage({ mailtrackBook: { n: 0 } });
  const book = createBook({ storage: st });
  const p1 = book.update(async (b) => { await sleep(15); b.n = 1; });
  const p2 = book.save({ n: 50 });
  const p3 = book.update((b) => { b.n++; });
  assert.deepEqual(await Promise.all([p1, p2, p3]), [{ n: 1 }, { n: 50 }, { n: 51 }]);
  assert.deepEqual(st.data.get('mailtrackBook'), { n: 51 });
});
await ta('chrome 은 처음 쓸 때 본다 — chrome 이 없을 때 만들어도 던지지 않고, 쓸 때 한국어로 거절한다. 나중에 생기면 그것을 쓴다', async () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'chrome');
  const saved = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const book = createBook({ normalize });
    const off = book.onChange(() => {});
    assert.equal(typeof off, 'function', 'onChanged 가 없으면 아무것도 하지 않는 함수');
    off();
    await assert.rejects(book.load(), /확장 저장소\(chrome\.storage\.local\)가 없습니다/);
    await assert.rejects(book.update(() => {}), /chrome\.storage\.local/);
    const st = fakeStorage({ mailtrackBook: { me: 'me@krs.co.kr' } });
    globalThis.chrome = { storage: { local: st, onChanged: st.onChanged } };
    assert.equal((await book.load()).me, 'me@krs.co.kr', '만들 때가 아니라 부를 때 chrome.storage.local 을 본다');
    const seen = [];
    const off2 = book.onChange((b) => seen.push(b.items.length));
    assert.equal(st.listeners.size, 1, 'chrome.storage.onChanged 에 붙었다');
    await book.update((b) => { b.items.push({ id: 'A' }); });
    assert.deepEqual(seen, [1]);
    off2();
    assert.equal(st.listeners.size, 0, '돌려준 함수로 뗀다');
  } finally {
    if (had) globalThis.chrome = saved; else delete globalThis.chrome;
  }
});
await ta('onChange — 그 키·local 영역만, 꼴 맞춘 새 장부로 부른다. 주입한 onChanged 를 쓰고, 돌려준 함수로 그만 듣는다', async () => {
  const listeners = new Set();
  const onChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (changes, area) => { for (const fn of listeners) fn(changes, area); };
  const book = createBook({ storage: fakeStorage(), normalize, onChanged });
  const seen = [];
  const off = book.onChange((b, ch) => seen.push([b.me, b.normalized, ch.oldValue?.me ?? null]));
  emit({ mailtrackBook: { oldValue: { me: 'old@krs.co.kr' }, newValue: { me: 'me@krs.co.kr' } } }, 'local');
  emit({ otherKey: { newValue: { me: 'x' } } }, 'local');
  emit({ mailtrackBook: { newValue: { me: 'sync@krs.co.kr' } } }, 'sync');
  emit({ mailtrackBook: { oldValue: { me: 'me@krs.co.kr' } } }, 'local');
  assert.deepEqual(seen, [['me@krs.co.kr', true, 'old@krs.co.kr'], ['', true, 'me@krs.co.kr']], '지운 장부(newValue 없음)는 기본값으로 알린다');
  off();
  emit({ mailtrackBook: { newValue: { me: 'late@krs.co.kr' } } }, 'local');
  assert.equal(seen.length, 2);
  assert.equal(listeners.size, 0);
});

/* ------------------------------------------------------------ 가짜 IndexedDB */

/**
 * IndexedDB 흉내(이 시험이 쓰는 만큼만): open(이름, 버전) + onupgradeneeded/onsuccess/onerror, createObjectStore(키는 값 밖)·createIndex,
 * transaction(요청이 다 돌면 complete)·put/get/delete/getAll·index().getAll/getAllKeys·openCursor. 값은 structured clone 으로 넣고 꺼낸다.
 */
function fakeIndexedDB() {
  const dbs = new Map();   // 이름 → { version, upgrading, stores: Map<이름, { keyPath, autoIncrement, indexes: Map, data: Map }> }
  const log = { opened: [], closed: 0, upgrades: [], tx: [] };
  const clone = (v) => structuredClone(v);
  const sortedKeys = (m) => [...m.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  function makeTx(rec, scope, mode) {
    const queue = [];
    let finished = false;
    const tx = {
      mode, error: null, oncomplete: null, onerror: null, onabort: null,
      objectStore(n) {
        if (!scope.includes(n)) throw new Error('NotFoundError: 트랜잭션 범위 밖 ' + n);
        return storeApi(rec.stores.get(n));
      },
      abort() { if (!finished) { finished = true; tx.onabort?.({ target: tx }); } },
    };
    setTimeout(() => {
      while (queue.length && !finished) queue.shift()();
      if (!finished) { finished = true; tx.oncomplete?.({ target: tx }); }
    }, 0);
    const request = (compute) => {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      queue.push(() => { req.result = compute(); req.onsuccess?.({ target: req }); });
      return req;
    };
    const writable = () => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); };
    const storeApi = (s) => ({
      put(value, key) {
        writable();
        if (s.keyPath === null && key === undefined) throw new Error('DataError: 키가 값 밖인데 키를 주지 않았다');
        const v = clone(value);
        return request(() => { s.data.set(key, v); return key; });
      },
      get: (key) => request(() => (s.data.has(key) ? clone(s.data.get(key)) : undefined)),
      delete(key) { writable(); return request(() => { s.data.delete(key); }); },
      getAll: () => request(() => sortedKeys(s.data).map((k) => clone(s.data.get(k)))),
      openCursor() {
        const req = { result: null, onsuccess: null, onerror: null };
        const keys = sortedKeys(s.data);
        let i = 0;
        const step = () => {
          req.result = i < keys.length
            ? { key: keys[i], primaryKey: keys[i], value: clone(s.data.get(keys[i])), continue() { i++; queue.push(step); } }
            : null;
          req.onsuccess?.({ target: req });
        };
        queue.push(step);
        return req;
      },
      index(name) {
        const ix = s.indexes.get(name);
        if (!ix) throw new Error('NotFoundError: index ' + name);
        const hits = (q) => sortedKeys(s.data).filter((k) => s.data.get(k)?.[ix.keyPath] === q);
        return { getAll: (q) => request(() => hits(q).map((k) => clone(s.data.get(k)))), getAllKeys: (q) => request(() => hits(q)) };
      },
    });
    return tx;
  }

  function makeDb(name, rec) {
    let closed = false;
    return {
      name,
      get version() { return rec.version; },
      objectStoreNames: { contains: (n) => rec.stores.has(n), get length() { return rec.stores.size; } },
      onversionchange: null,
      createObjectStore(n, opts = {}) {
        if (!rec.upgrading) throw new Error('InvalidStateError: 버전 바꾸기 밖에서 스토어를 만들 수 없다');
        if (rec.stores.has(n)) throw new Error('ConstraintError: 이미 있는 스토어 ' + n);
        const s = { keyPath: opts.keyPath ?? null, autoIncrement: !!opts.autoIncrement, indexes: new Map(), data: new Map() };
        rec.stores.set(n, s);
        return { name: n, createIndex(i, keyPath, o = {}) { s.indexes.set(i, { keyPath, unique: !!o.unique, multiEntry: !!o.multiEntry }); return { name: i, keyPath }; } };
      },
      transaction(names, mode = 'readonly') {
        if (closed) throw new Error('InvalidStateError: 닫힌 DB');
        const scope = [].concat(names);
        for (const n of scope) if (!rec.stores.has(n)) throw new Error('NotFoundError: 스토어 ' + n);
        log.tx.push([scope.join('+'), mode]);
        return makeTx(rec, scope, mode);
      },
      close() { if (!closed) { closed = true; log.closed++; } },
    };
  }

  return {
    dbs, log,
    open(name, version) {
      log.opened.push([name, version]);
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        let rec = dbs.get(name);
        if (!rec) { rec = { version: 0, upgrading: false, stores: new Map() }; dbs.set(name, rec); }
        if (version < rec.version) { req.error = new Error('VersionError'); req.onerror?.({ target: req }); return; }
        req.result = makeDb(name, rec);
        if (version > rec.version) {
          const oldVersion = rec.version;
          rec.version = version;
          rec.upgrading = true;
          log.upgrades.push([name, oldVersion, version]);
          try { req.onupgradeneeded?.({ target: req, oldVersion, newVersion: version }); } finally { rec.upgrading = false; }
        }
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };
}

/* ------------------------------------------------------------ 금고 */

const ME = { name: '나', address: 'me@krs.co.kr' };
const FOO = { name: '김담당', address: 'kim@foo.com' };

/** 두 뒷단이 같은 시나리오를 똑같이 통과해야 한다. */
async function exercise(vault, label) {
  await ta(`${label} — 본문: 넣고(계약의 칸만) 꺼내고, 항목마다 받은 차례로, 없으면 null, 같은 키는 새것으로`, async () => {
    const put = await vault.putBody({ itemId: 'I1', messageId: 'R2', subject: 'RE: 양식 회신', from: FOO, receivedAt: '2026-10-14T02:00:00Z', contentType: 'html', content: '<p>첨부합니다</p>', extra: '담지 않는다' });
    assert.deepEqual(Object.keys(put).sort(), ['content', 'contentType', 'from', 'itemId', 'messageId', 'receivedAt', 'savedAt', 'subject']);
    await vault.putBody({ itemId: 'I1', messageId: 'S1', subject: '양식 작성 요청', from: ME, receivedAt: '2026-10-10T01:00:00Z', contentType: 'text', content: '작성 부탁드립니다' });
    await vault.putBody({ itemId: 'I2', messageId: 'S9', subject: '다른 건', from: ME, receivedAt: '2026-10-01T00:00:00Z', content: 'x' });
    const got = await vault.getBody('I1', 'R2');
    assert.deepEqual(got, { itemId: 'I1', messageId: 'R2', subject: 'RE: 양식 회신', from: FOO, receivedAt: '2026-10-14T02:00:00Z', contentType: 'html', content: '<p>첨부합니다</p>', savedAt: put.savedAt });
    assert.equal(await vault.getBody('I1', '없음'), null);
    assert.equal(await vault.getBody('I2', 'R2'), null, '다른 항목의 같은 메일 ID 는 다른 칸');
    assert.deepEqual((await vault.bodies('I1')).map((b) => b.messageId), ['S1', 'R2'], '받은 차례(receivedAt)');
    assert.equal((await vault.bodies('I2'))[0].contentType, 'text', 'contentType 이 없으면 text');
    assert.deepEqual(await vault.bodies('I0'), []);
    got.content = '꺼낸 것을 고쳐도';
    assert.equal((await vault.getBody('I1', 'R2')).content, '<p>첨부합니다</p>', '담긴 것은 그대로');
    await vault.putBody({ itemId: 'I1', messageId: 'R2', subject: 'RE: 양식 회신', from: FOO, receivedAt: '2026-10-14T02:00:00Z', contentType: 'html', content: '<p>다시</p>' });
    assert.deepEqual([(await vault.bodies('I1')).length, (await vault.getBody('I1', 'R2')).content], [2, '<p>다시</p>']);
  });
  await ta(`${label} — 첨부: 바이트는 Uint8Array 로 꺼낸다. 조각(subarray)은 딱 맞게 복사해 담고, ArrayBuffer 도 받는다`, async () => {
    const big = new Uint8Array(4096);
    big.set([0x50, 0x4b, 0x03, 0x04], 100);
    const tpl = await vault.putFile({ itemId: 'I1', messageId: 'S1', attachmentId: 'A0', name: '양식.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 9000, bytes: big.subarray(100, 104) });
    assert.deepEqual([tpl.size, tpl.bytes.byteLength, tpl.bytes.buffer.byteLength], [9000, 4, 4], 'size 는 Graph 가 말한 크기, 바이트는 딱 4');
    await vault.putFile({ itemId: 'I1', messageId: 'R2', attachmentId: 'B1', name: '회신.docx', bytes: new Uint8Array([1, 2, 3]).buffer });
    await vault.putFile({ itemId: 'I2', messageId: 'S9', attachmentId: 'C1', name: '다른.pdf', contentType: 'application/pdf', bytes: [7, 7] });
    const f = await vault.getFile('I1', 'S1', 'A0');
    assert.ok(f.bytes instanceof Uint8Array);
    assert.deepEqual([...f.bytes], [0x50, 0x4b, 0x03, 0x04]);
    assert.deepEqual(Object.keys(f).sort(), ['attachmentId', 'bytes', 'contentType', 'itemId', 'messageId', 'name', 'savedAt', 'size']);
    const r = await vault.getFile('I1', 'R2', 'B1');
    assert.deepEqual([r.name, r.contentType, r.size, [...r.bytes]], ['회신.docx', 'application/octet-stream', 3, [1, 2, 3]], 'size 가 없으면 바이트 길이, 종류가 없으면 octet-stream');
    assert.equal(await vault.getFile('I1', 'S1', '없음'), null);
    const list = await vault.files('I1');
    assert.deepEqual(list.map((x) => x.attachmentId), ['A0', 'B1'], '담은 차례');
    assert.ok(list.every((x) => x.bytes instanceof Uint8Array));
    f.bytes[0] = 0;
    assert.equal((await vault.getFile('I1', 'S1', 'A0')).bytes[0], 0x50, '꺼낸 바이트를 고쳐도 담긴 것은 그대로');
  });
  await ta(`${label} — 칸이 빠진 것은 담지 않고 한국어로 거절한다`, async () => {
    await assert.rejects(vault.putBody({ itemId: 'I1', content: 'x' }), /본문에 messageId 가 없습니다/);
    await assert.rejects(vault.putFile({ itemId: 'I1', messageId: 'R2', name: 'a.xlsx', bytes: new Uint8Array(1) }), /첨부에 attachmentId 가 없습니다/);
    await assert.rejects(vault.putFile({ itemId: 'I1', messageId: 'R2', attachmentId: 'Z', name: 'a.xlsx' }), /첨부\(a\.xlsx\)에 바이트가 없습니다/);
    await assert.rejects(vault.putFile({ itemId: 'I1', messageId: 'R2', attachmentId: 'Z', name: 'b.xlsx', bytes: 'AAAA' }), /바이트가 없습니다/, 'base64 글자는 받지 않는다 — 어댑터가 Uint8Array 로 풀어 준다');
    assert.equal(await vault.getFile('I1', 'R2', 'Z'), null);
  });
  await ta(`${label} — usage 는 본문 수·첨부 수·바이트(본문 UTF-8 + 첨부)를 센다. removeItem 은 그 항목의 것만 두 스토어에서 지운다`, async () => {
    const enc = (s) => new TextEncoder().encode(s).length;
    const before = await vault.usage();
    assert.deepEqual(before, { bodies: 3, files: 3, bytes: enc('작성 부탁드립니다') + enc('<p>다시</p>') + enc('x') + 4 + 3 + 2 });
    assert.deepEqual(await vault.removeItem('I1'), { bodies: 2, files: 2 });
    assert.deepEqual([await vault.bodies('I1'), await vault.files('I1')], [[], []]);
    assert.deepEqual([(await vault.bodies('I2')).length, (await vault.files('I2')).length], [1, 1], '다른 항목은 그대로');
    assert.deepEqual(await vault.usage(), { bodies: 1, files: 1, bytes: 1 + 2 });
    assert.deepEqual(await vault.removeItem('I0'), { bodies: 0, files: 0 });
  });
}

console.log('금고(store/vault.js)');
t('키 — 항목·메일·첨부를 \\u0001 로 잇는다. DB 이름은 krsMailtrack v1 (증빙 보관함의 krsWorkspace 와 따로)', () => {
  assert.deepEqual([VAULT_DB, VAULT_VERSION, BODIES, FILES, ITEM_INDEX], ['krsMailtrack', 1, 'bodies', 'files', 'itemId']);
  assert.equal(bodyKey('I1', 'M/1+='), 'I1\u0001M/1+=');
  assert.equal(fileKey('I1', 'M1', 'A1'), 'I1\u0001M1\u0001A1');
});
t('toBytes — 딱 맞는 Uint8Array 는 그대로, 조각·다른 TypedArray·ArrayBuffer·숫자 배열은 복사, 그 밖은 null', () => {
  const u = new Uint8Array([1, 2]);
  assert.equal(toBytes(u), u);
  const piece = toBytes(new Uint8Array([9, 1, 2, 9]).subarray(1, 3));
  assert.deepEqual([[...piece], piece.buffer.byteLength], [[1, 2], 2]);
  assert.deepEqual([...toBytes(new Uint16Array([0x0201]))], [1, 2]);
  assert.deepEqual([...toBytes(new Uint8Array([5]).buffer)], [5]);
  assert.deepEqual([...toBytes([3, 4])], [3, 4]);
  assert.deepEqual([toBytes(null), toBytes(undefined), toBytes('AAAA'), toBytes({})], [null, null, null, null]);
});

{
  let tick = 0;
  await exercise(createVault(memoryBackend(), { now: () => ++tick }), '메모리 뒷단');
}

await ta('IndexedDB 가 없으면 만들 때는 조용하고 쓸 때 한국어로 거절한다 — createVault() 는 처음 부를 때 뒷단을 만든다', async () => {
  assert.equal(globalThis.indexedDB, undefined, 'Node 에는 indexedDB 가 없다');
  const v = createVault();
  const w = createVault(idbBackend({ idb: null }));
  for (const vault of [v, w]) {
    await assert.rejects(vault.getBody('I1', 'M1'), /메일 금고\(IndexedDB\)가 없습니다/);
    await assert.rejects(vault.putBody({ itemId: 'I1', messageId: 'M1', content: 'x' }), /메일 금고\(IndexedDB\)가 없습니다/);
    await assert.rejects(vault.usage(), /IndexedDB/);
  }
});
await ta('createVault() 는 만들 때가 아니라 처음 부를 때 globalThis.indexedDB 를 본다', async () => {
  const fake = fakeIndexedDB();
  const v = createVault();
  assert.equal(fake.log.opened.length, 0);
  globalThis.indexedDB = fake;
  try {
    await v.putBody({ itemId: 'I1', messageId: 'M1', content: '본문' });
    assert.equal((await v.getBody('I1', 'M1')).content, '본문');
    assert.deepEqual(fake.log.opened.map((x) => x[0]), ['krsMailtrack', 'krsMailtrack']);
  } finally {
    delete globalThis.indexedDB;
  }
});
await ta('onupgradeneeded 는 bodies·files 두 스토어(키는 값 밖)와 itemId index 를 만든다 — 처음 한 번만, krsWorkspace 는 열지 않는다', async () => {
  const fake = fakeIndexedDB();
  const vault = createVault(idbBackend({ idb: fake }));
  assert.equal(fake.log.opened.length, 0, '만들기만으로는 열지 않는다');
  assert.equal(await vault.getBody('I1', 'M1'), null);
  await vault.bodies('I1');
  const rec = fake.dbs.get('krsMailtrack');
  assert.equal(rec.version, 1);
  assert.deepEqual([...rec.stores.keys()].sort(), ['bodies', 'files']);
  for (const name of ['bodies', 'files']) {
    const s = rec.stores.get(name);
    assert.deepEqual([s.keyPath, s.autoIncrement], [null, false], `${name}: 키는 값 밖(out-of-line)`);
    assert.deepEqual([...s.indexes], [['itemId', { keyPath: 'itemId', unique: false, multiEntry: false }]], `${name}: itemId index`);
  }
  assert.deepEqual(fake.log.upgrades, [['krsMailtrack', 0, 1]], '버전 바꾸기는 처음 한 번');
  assert.deepEqual(fake.log.opened, [['krsMailtrack', 1], ['krsMailtrack', 1]]);
  assert.equal(fake.dbs.has('krsWorkspace'), false);
  assert.equal(fake.log.closed, 2, '부를 때마다 열고 닫는다');
});
t('upgradeVault — 이미 있는 스토어는 건드리지 않는다(같은 DB 를 두 번 올려도 ConstraintError 없음)', () => {
  const made = [];
  const db = { objectStoreNames: { contains: (n) => n === 'bodies' }, createObjectStore: (n) => { made.push(n); return { createIndex: (i, k) => made.push(`${n}.${i}=${k}`) }; } };
  upgradeVault(db, 0);
  assert.deepEqual(made, ['files', 'files.itemId=itemId']);
  made.length = 0;
  upgradeVault({ ...db, objectStoreNames: { contains: () => false } }, 1);
  assert.deepEqual(made, [], 'v1 에서 v1 로는 만들 것이 없다');
});
await ta('DB 가 이미 더 높은 버전이면(다음 판이 올려 둔 것) 열지 못했다고 거절한다', async () => {
  const fake = fakeIndexedDB();
  fake.dbs.set('krsMailtrack', { version: 2, upgrading: false, stores: new Map() });
  await assert.rejects(createVault(idbBackend({ idb: fake })).bodies('I1'), /VersionError/);
});
{
  const fake = fakeIndexedDB();
  let tick = 0;
  await exercise(createVault(idbBackend({ idb: fake }), { now: () => ++tick }), 'IndexedDB 뒷단(가짜)');
  await ta('IndexedDB 뒷단 — 연 만큼 닫았고, 지우기는 두 스토어를 한 트랜잭션(readwrite)으로, 넣기는 그 스토어만 readwrite, 읽기는 readonly 로', async () => {
    assert.equal(fake.log.closed, fake.log.opened.length);
    assert.ok(fake.log.opened.every(([name, ver]) => name === 'krsMailtrack' && ver === 1));
    const kinds = [...new Set(fake.log.tx.map(([scope, mode]) => `${scope}:${mode}`))].sort();
    assert.deepEqual(kinds, ['bodies+files:readwrite', 'bodies:readonly', 'bodies:readwrite', 'files:readonly', 'files:readwrite']);
    assert.equal(fake.log.tx.filter(([scope]) => scope === 'bodies+files').length, 2, 'removeItem 두 번 — 한 번에 한 트랜잭션');
  });
}

console.log(`\n통과 ${pass}건`);
