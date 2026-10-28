import { normalizeUrl, validateDraft } from './model.js';

export const STORE_KEY = 'taskContextStore';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const invalid = () => { throw new StoreError('INVALID', '저장 데이터 형식을 확인할 수 없습니다. 원본을 보존하며 변경을 중단합니다.'); };
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k))) invalid();
}
function string(value, max, nonempty = false) {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) invalid();
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
export function validateStore(raw) {
  if (raw === undefined) return { schemaVersion: 1, revision: 0, tasks: [] };
  if (raw?.schemaVersion !== 1) throw new StoreError('SCHEMA', '지원하지 않는 데이터 버전입니다. 원본을 보존하며 변경을 중단합니다.');
  shape(raw,['schemaVersion','revision','tasks']);
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.tasks) || raw.tasks.length > 100) invalid();
  const ids = new Set();
  for (const task of raw.tasks) {
    shape(task,['id','name','nextAction','tabs','startTabId','createdAt','updatedAt']);
    if (!UUID.test(task.id) || ids.has(task.id)) invalid();
    ids.add(task.id);
    string(task.name,80,true); string(task.nextAction,500);
    timestamp(task.createdAt); timestamp(task.updatedAt);
    if (task.updatedAt < task.createdAt || !Array.isArray(task.tabs) || !task.tabs.length || task.tabs.length > 200) invalid();
    const urls = new Set(), tabIds = new Set();
    task.tabs.forEach((tab,index) => {
      shape(tab,['id','title','url','order']);
      if (!UUID.test(tab.id) || ids.has(tab.id) || tab.order !== index) invalid();
      ids.add(tab.id); tabIds.add(tab.id); string(tab.title,500,true);
      let url;
      try { url = normalizeUrl(tab.url); } catch { invalid(); }
      if (url !== tab.url || urls.has(url)) invalid();
      urls.add(url);
    });
    if (!tabIds.has(task.startTabId)) invalid();
  }
  return structuredClone(raw);
}
export function taskFromDraft(draft, previous, now = new Date().toISOString(), makeId = () => crypto.randomUUID()) {
  const error = validateDraft(draft);
  if (error) throw new StoreError('INPUT',error);
  const selected = draft.tabs.filter(t => draft.selectedIds.includes(t.id));
  return {
    id: previous?.id || makeId(), name: draft.name.trim(), nextAction: draft.nextAction,
    tabs: selected.map((t,order) => ({ id:t.id, title:t.title, url:t.url, order })),
    startTabId:draft.startTabId, createdAt:previous?.createdAt || now,
    updatedAt: previous && now < previous.updatedAt ? previous.updatedAt : now
  };
}
export function createRepository(area = globalThis.chrome?.storage?.local, options = {}) {
  let busy = false;
  const read = async () => {
    if (!area?.get || !area?.set) throw new StoreError('API','Chrome 확장에서 저장소를 사용할 수 없습니다.');
    try { return validateStore((await area.get(STORE_KEY))[STORE_KEY]); }
    catch (error) { if (error instanceof StoreError) throw error; throw new StoreError('READ','저장 목록을 읽지 못했습니다. 다시 읽어주세요.'); }
  };
  const write = async (expected, transform) => {
    if (busy) throw new StoreError('BUSY','저장 처리 중입니다. 잠시 기다려주세요.');
    busy = true;
    const commit = async () => {
      const current = await read();
      if (current.revision !== expected.revision || !same(current,expected)) throw new StoreError('CONFLICT','다른 화면에서 작업이 바뀌었습니다. 입력은 유지됩니다. 목록을 다시 읽고 편집을 시작하세요.');
      const next = validateStore({ ...current, revision:current.revision+1, tasks:transform(structuredClone(current.tasks)) });
      if (new TextEncoder().encode(JSON.stringify(next)).length > (options.maxBytes ?? 5*1024*1024)) throw new StoreError('QUOTA','저장 한도를 초과합니다. 탭·메모를 줄이거나 기존 작업을 삭제하세요.');
      try { await area.set({[STORE_KEY]:next}); }
      catch { throw new StoreError('WRITE','저장하지 못했습니다. 입력은 유지됩니다. 저장 공간과 확장 상태를 확인한 뒤 재시도하세요.'); }
      let confirmed;
      try { confirmed = await read(); }
      catch { throw new StoreError('UNCERTAIN','저장 요청 후 결과를 확인하지 못했습니다. 중복 저장을 막기 위해 목록을 다시 읽어주세요.'); }
      if (!same(confirmed,next)) throw new StoreError('UNCERTAIN','저장 직후 데이터가 변경되었습니다. 목록을 다시 읽어 결과를 확인하세요.');
      return confirmed;
    };
    try {
      const locks = options.locks ?? globalThis.navigator?.locks;
      return locks ? await locks.request('task-context-store-write',commit) : await commit();
    } finally { busy = false; }
  };
  return {
    read,
    save(expected,draft,taskId) {
      return write(expected,tasks => {
        const previous = taskId ? tasks.find(t=>t.id===taskId) : undefined;
        if (taskId && !previous) throw new StoreError('CONFLICT','작업이 삭제되었습니다. 목록을 다시 읽어주세요.');
        if (!previous && tasks.length >= 100) throw new StoreError('LIMIT','작업은 100개까지 저장할 수 있습니다.');
        const task = taskFromDraft(draft,previous);
        return previous ? tasks.map(t=>t.id===taskId?task:t) : [...tasks,task];
      });
    },
    remove(expected,id) {
      return write(expected,tasks => {
        if (!tasks.some(t=>t.id===id)) throw new StoreError('CONFLICT','이미 삭제된 작업입니다. 목록을 다시 읽어주세요.');
        return tasks.filter(t=>t.id!==id);
      });
    }
  };
}
