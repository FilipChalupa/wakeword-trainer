import { ApiError, type Recording, type RecordingsClient } from "../api";

/** Takes that were recorded but not yet stored on the server, kept in IndexedDB so a dropped connection, a
 *  server restart or a closed tab does not lose them. `scope` tells which project (or contributor link) a take
 *  belongs to, because the server stores an upload under whatever is current at that moment. */
export type PendingTake = { id: string; scope: string; kind: string; tag: string | null; wav: Blob; createdAt: string };

const DB = "wakeword-trainer";
const STORE = "pending-takes";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const available = () => typeof indexedDB !== "undefined";

/** Storage is a safety net: a failure here must never stop the recording itself. */
const store = {
  async put(take: PendingTake): Promise<void> {
    if (!available()) return;
    await run("readwrite", (s) => s.put(take)).catch(() => undefined);
  },
  async remove(id: string): Promise<void> {
    if (!available()) return;
    await run("readwrite", (s) => s.delete(id)).catch(() => undefined);
  },
  async list(scope: string): Promise<PendingTake[]> {
    if (!available()) return [];
    const all = await run<PendingTake[]>("readonly", (s) => s.getAll()).catch(() => [] as PendingTake[]);
    return all.filter((t) => t.scope === scope).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The server answered and refused the take (no speech, too long…): keeping a copy would not help. */
const refused = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

const inFlight = new Set<string>();

/** Uploads a take with a copy held in the browser until the server has it. A refusal drops the copy,
 *  a dead connection or a server error keeps it for later; `wasKept` on the thrown error says which. */
export async function uploadKept(client: RecordingsClient, scope: string, kind: string, wav: Blob, tag: string | null): Promise<Recording> {
  const id = newId();
  inFlight.add(id);
  await store.put({ id, scope, kind, tag, wav, createdAt: new Date().toISOString() });
  try {
    const rec = await client.uploadRecording(kind, wav, "sample.wav", tag);
    await store.remove(id);
    return rec;
  } catch (e) {
    if (refused(e)) await store.remove(id);
    else if (e && typeof e === "object") (e as { kept?: boolean }).kept = available();
    throw e;
  } finally {
    inFlight.delete(id);
  }
}

export const wasKept = (e: unknown): boolean => Boolean(e && typeof e === "object" && (e as { kept?: boolean }).kept);

/** Takes waiting in the browser for this scope, without those this tab is uploading right now. */
export async function waitingTakes(scope: string): Promise<PendingTake[]> {
  return (await store.list(scope)).filter((t) => !inFlight.has(t.id));
}

/** Uploads what is waiting; a take the server refuses is dropped, one it cannot receive stays. */
export async function flushTakes(client: RecordingsClient, scope: string): Promise<{ uploaded: number; dropped: number; left: number }> {
  const result = { uploaded: 0, dropped: 0, left: 0 };
  for (const take of await waitingTakes(scope)) {
    inFlight.add(take.id);
    try {
      await client.uploadRecording(take.kind, take.wav, "sample.wav", take.tag);
      await store.remove(take.id);
      result.uploaded += 1;
    } catch (e) {
      if (refused(e)) {
        await store.remove(take.id);
        result.dropped += 1;
      } else result.left += 1;
    } finally {
      inFlight.delete(take.id);
    }
  }
  return result;
}

export async function discardTakes(scope: string): Promise<void> {
  for (const take of await waitingTakes(scope)) await store.remove(take.id);
}
