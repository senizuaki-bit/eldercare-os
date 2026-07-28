const STORAGE_PREFIX = 'eldercare:m03:idempotency:';
const memoryKeys = new Map<string, string>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

function createIdempotencyKey(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${id}`;
}

function readStoredKey(scope: string): string | null {
  const key = storageKey(scope);
  if (typeof window !== 'undefined') {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      // The in-memory fallback still prevents duplicate keys during this page lifetime.
    }
  }
  return memoryKeys.get(key) ?? null;
}

function writeStoredKey(scope: string, value: string): void {
  const key = storageKey(scope);
  memoryKeys.set(key, value);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }
}

export function getOrCreateM03OperationKey(scope: string, prefix: string): string {
  const stored = readStoredKey(scope);
  if (stored) return stored;
  const created = createIdempotencyKey(prefix);
  writeStoredKey(scope, created);
  return created;
}

export function finishM03Operation(scope: string, completedKey: string): void {
  const key = storageKey(scope);
  if (readStoredKey(scope) !== completedKey) return;
  memoryKeys.delete(key);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // The matching in-memory key has already been removed.
    }
  }
}

export function cancelM03Operation(scope: string): void {
  const existing = readStoredKey(scope);
  if (existing) finishM03Operation(scope, existing);
}

export function m03OperationStorageKey(scope: string): string {
  return storageKey(scope);
}
