// Картинки черновика в IndexedDB окна по id брифа. Текст черновика с метками
// «[картинка N]» живёт в localStorage и переживает перезагрузку плагина, а
// картинки до этого жили только в памяти модуля и пропадали: ответ уходил с
// метками без картинок. В localStorage картинки не влезают — там около 5 МБ,
// а брифу разрешено 16 МБ. Хранилище — удобство: недоступно или сломалось —
// картинки живут, как раньше, до перезагрузки.
import type { AnswerImage } from "../shared/contract";

/** Прочитанная картинка пула; `weight` — длина base64, по ней считается предел. */
export type StoredImage = AnswerImage & { weight: number };
/** Пул брифа на диске: прочитанные картинки и следующий свободный номер метки. */
export type StoredPool = { images: StoredImage[]; next: number };

const DB = "flow-answer-images";
const STORE = "pools";

let opened: Promise<IDBDatabase | null> | null = null;

const database = (): Promise<IDBDatabase | null> =>
  (opened ??= new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB?.open(DB, 1);
      if (request === undefined) return resolve(null);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));

/** Один запрос к хранилищу; любой сбой — `fallback`, а не исключение. */
const run = async <T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> => {
  const db = await database();
  if (db === null) return fallback;
  return new Promise((resolve) => {
    try {
      const request = make(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
      request.onerror = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
};

const isPool = (value: unknown): value is StoredPool =>
  typeof value === "object" && value !== null && Array.isArray((value as StoredPool).images) && Number.isInteger((value as StoredPool).next);

export const loadPool = async (briefId: string): Promise<StoredPool | null> => {
  const value = await run<unknown>("readonly", (store) => store.get(briefId), null);
  return isPool(value) ? value : null;
};

export const savePool = (briefId: string, pool: StoredPool): Promise<void> => run("readwrite", (store) => store.put(pool, briefId), undefined);

export const dropPool = (briefId: string): Promise<void> => run("readwrite", (store) => store.delete(briefId), undefined);
