import { ChatMessage } from '../types';

export interface PersistedChatState {
  version: 1;
  sessionId: string;
  messages: ChatMessage[];
  leadSaved?: boolean;
  persistedLeadId?: string | null;
  customerName?: string;
  customerWhatsapp?: string;
  updatedAt: number;
}

const IDB_DB_NAME = 'armazem_do_carro_chat_db';
const IDB_DB_VERSION = 1;
const IDB_STORE_NAME = 'conversations';
const MAX_LOCAL_STORAGE_CHARS = 1_500_000;
const MAX_PERSISTED_MESSAGES = 120;

function isValidChatMessage(item: unknown): item is ChatMessage {
  if (!item || typeof item !== 'object') return false;
  const m = item as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    (m.sender === 'ia' || m.sender === 'cliente') &&
    typeof m.text === 'string' &&
    typeof m.timestamp === 'string'
  );
}

function sanitizePersistedState(raw: unknown): PersistedChatState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.sessionId !== 'string' ||
    obj.sessionId.trim().length < 6 ||
    !Array.isArray(obj.messages)
  ) {
    return null;
  }

  const validMessages = obj.messages
    .filter(isValidChatMessage)
    .slice(-MAX_PERSISTED_MESSAGES);

  if (validMessages.length === 0) return null;

  return {
    version: 1,
    sessionId: obj.sessionId.trim(),
    messages: validMessages,
    leadSaved: Boolean(obj.leadSaved),
    persistedLeadId:
      typeof obj.persistedLeadId === 'string' ? obj.persistedLeadId : null,
    customerName:
      typeof obj.customerName === 'string' ? obj.customerName : undefined,
    customerWhatsapp:
      typeof obj.customerWhatsapp === 'string'
        ? obj.customerWhatsapp
        : undefined,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
  };
}

/**
 * Produces a lightweight copy of the state without inline base64 data URLs
 * so localStorage never hits browser quota limits even when photos/PDFs/audio were sent.
 */
function buildCompactLocalCopy(state: PersistedChatState): PersistedChatState {
  return {
    ...state,
    messages: state.messages.slice(-MAX_PERSISTED_MESSAGES).map((m) => ({
      ...m,
      ...(m.audio
        ? {
            audio: {
              ...m.audio,
              url: m.audio.url.startsWith('data:') ? '' : m.audio.url,
            },
          }
        : {}),
      ...(m.attachment
        ? {
            attachment: {
              ...m.attachment,
              url: m.attachment.url.startsWith('data:') ? '' : m.attachment.url,
            },
          }
        : {}),
    })),
  };
}

function openChatDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !('indexedDB' in window)) {
        resolve(null);
        return;
      }
      const req = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        } catch {
          // Ignore upgrade errors
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readFromIndexedDb(
  storageKey: string
): Promise<PersistedChatState | null> {
  const db = await openChatDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(storageKey);
      req.onsuccess = () => {
        const sanitized = sanitizePersistedState(req.result);
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve(sanitized);
      };
      req.onerror = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
      resolve(null);
    }
  });
}

async function writeToIndexedDb(
  storageKey: string,
  state: PersistedChatState
): Promise<void> {
  const db = await openChatDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(state, storageKey);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve();
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve();
      };
      tx.onabort = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
      resolve();
    }
  });
}

async function deleteFromIndexedDb(storageKey: string): Promise<void> {
  const db = await openChatDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(storageKey);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve();
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
      resolve();
    }
  });
}

let idbQueue: Promise<unknown> = Promise.resolve();

function enqueueIdbOp<T>(op: () => Promise<T>): Promise<T> {
  const next = idbQueue.then(op, op);
  idbQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Synchronous read from localStorage for instant initial restoration without UI flicker.
 */
export function loadLocalChatStateSync(
  storageKey: string
): PersistedChatState | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return sanitizePersistedState(parsed);
  } catch {
    return null;
  }
}

/**
 * Asynchronous read from IndexedDB to restore full media payloads (audio/image/PDF)
 * that may have been trimmed from localStorage to respect storage quotas.
 */
export async function loadLocalChatStateAsync(
  storageKey: string
): Promise<PersistedChatState | null> {
  try {
    return await enqueueIdbOp(() => readFromIndexedDb(storageKey));
  } catch {
    return null;
  }
}

/**
 * Persists chat state safely to both localStorage (with automatic quota fallback)
 * and IndexedDB (full fidelity including audio and attachment data URLs).
 */
export function saveLocalChatState(
  storageKey: string,
  state: PersistedChatState
): void {
  const normalized: PersistedChatState = {
    ...state,
    version: 1,
    messages: state.messages.slice(-MAX_PERSISTED_MESSAGES),
    updatedAt: Date.now(),
  };

  // 1. Write full state (including audio/attachment URLs) to IndexedDB asynchronously
  void enqueueIdbOp(() => writeToIndexedDb(storageKey, normalized));

  // 2. Write to localStorage synchronously with automatic quota fallback
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const fullSerialized = JSON.stringify(normalized);
    if (fullSerialized.length <= MAX_LOCAL_STORAGE_CHARS) {
      try {
        window.localStorage.setItem(storageKey, fullSerialized);
        return;
      } catch {
        // QuotaExceededError — fall through to compact copy
      }
    }
    const compactCopy = buildCompactLocalCopy(normalized);
    window.localStorage.setItem(storageKey, JSON.stringify(compactCopy));
  } catch {
    // Storage blocked or quota exceeded even for compact copy — fail silently
  }
}

/**
 * Clears saved conversation history from both localStorage and IndexedDB.
 */
export function clearLocalChatState(storageKey: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage access errors
  }
  void enqueueIdbOp(() => deleteFromIndexedDb(storageKey));
}
