export interface ReceiverStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ReceiverWorkspaceNotes {
  text: string;
  updatedAt: string | null;
  storageAvailable: boolean;
}

const STORAGE_PREFIX = "narrowslink:receiver-workspace:v1";
export const MAX_RECEIVER_NOTES_LENGTH = 20_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function defaultStorage(): ReceiverStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(bundleSha256: string): string | null {
  return SHA256_PATTERN.test(bundleSha256)
    ? `${STORAGE_PREFIX}:${bundleSha256}`
    : null;
}

function storageTarget(
  storage: ReceiverStorageLike | null | undefined,
): ReceiverStorageLike | null {
  return storage === undefined ? defaultStorage() : storage;
}

export function loadReceiverNotes(
  bundleSha256: string,
  storage?: ReceiverStorageLike | null,
): ReceiverWorkspaceNotes {
  const key = storageKey(bundleSha256);
  const target = storageTarget(storage);
  if (key === null || target === null) {
    return { text: "", updatedAt: null, storageAvailable: false };
  }
  let raw: string | null;
  try {
    raw = target.getItem(key);
  } catch {
    return { text: "", updatedAt: null, storageAvailable: false };
  }
  if (raw === null) return { text: "", updatedAt: null, storageAvailable: true };
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      typeof value !== "object"
      || value === null
      || (value as { version?: unknown }).version !== 1
      || typeof (value as { text?: unknown }).text !== "string"
      || (value as { text: string }).text.length > MAX_RECEIVER_NOTES_LENGTH
      || typeof (value as { updatedAt?: unknown }).updatedAt !== "string"
      || !Number.isFinite(Date.parse((value as { updatedAt: string }).updatedAt))
    ) return { text: "", updatedAt: null, storageAvailable: true };
    return {
      text: (value as { text: string }).text,
      updatedAt: (value as { updatedAt: string }).updatedAt,
      storageAvailable: true,
    };
  } catch {
    return { text: "", updatedAt: null, storageAvailable: true };
  }
}

export function saveReceiverNotes(
  bundleSha256: string,
  text: string,
  storage?: ReceiverStorageLike | null,
): boolean {
  const key = storageKey(bundleSha256);
  const target = storageTarget(storage);
  if (
    key === null
    || target === null
    || typeof text !== "string"
    || text.length > MAX_RECEIVER_NOTES_LENGTH
  ) return false;
  try {
    target.setItem(key, JSON.stringify({
      version: 1,
      text,
      updatedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearReceiverNotes(
  bundleSha256: string,
  storage?: ReceiverStorageLike | null,
): boolean {
  const key = storageKey(bundleSha256);
  const target = storageTarget(storage);
  if (key === null || target === null) return false;
  try {
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
