/**
 * Minimal IndexedDB access, shared by the static app and its service worker.
 * Stores: `projects` (id → project record) and `files` (`<projectId>/<path>` → file).
 */
export interface StoredFile {
  type: string;
  data: Uint8Array;
}

const DB_NAME = 'static-conversion';
const STORES = ['projects', 'files'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
  return result((await db()).transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbGetAll<T>(store: Store): Promise<T[]> {
  return result((await db()).transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

/** Write several entries in one transaction. */
export async function idbPutMany(store: Store, entries: Array<[string, unknown]>): Promise<void> {
  const tx = (await db()).transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [k, v] of entries) os.put(v, k);
  return done(tx);
}

export const idbPut = (store: Store, key: string, value: unknown) => idbPutMany(store, [[key, value]]);
