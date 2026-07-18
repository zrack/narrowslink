import {
  encodeSessionDocument,
  MAX_SESSION_FILE_BYTES,
  serializeSessionDocument,
  utf8ByteLength,
} from "../data/session-file";
import { parseSession, validateSessionDocument } from "../domain/session";
import type { CaptureIntegrityReceipt, ParsedSession, SessionDocument } from "../domain/types";

export const SESSION_LIBRARY_DB_NAME = "narrowslink-session-library";
export const SESSION_LIBRARY_DB_VERSION = 1;
export const SESSION_LIBRARY_STORE_NAME = "sessions";

const SESSION_LIBRARY_RECORD_VERSION = 1;

export type SessionLibraryErrorCode =
  | "unavailable"
  | "not-found"
  | "corrupt"
  | "too-large"
  | "quota"
  | "write-failed"
  | "transaction-failed"
  | "open-failed";

export class SessionLibraryError extends Error {
  readonly code: SessionLibraryErrorCode;

  constructor(code: SessionLibraryErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionLibraryError";
    this.code = code;
  }
}

export interface SessionLibraryEntry {
  readonly identity: string;
  readonly sessionId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly displayTimeZone: string;
  readonly durationUs: number;
  readonly formatVersion: 1 | 2;
  readonly sourceKind: SessionDocument["source"]["kind"];
  readonly sourceLabel: string;
  readonly decoderId: string;
  readonly decoderRevision: string;
  readonly decoderSchemaHash: string;
  readonly captureIntegrityStatus: CaptureIntegrityReceipt["status"];
  readonly recordCount: number;
  readonly byteLength: number;
  readonly savedAt: string;
}

export interface SessionLibrary {
  save(document: SessionDocument): Promise<SessionLibraryEntry>;
  list(): Promise<SessionLibraryEntry[]>;
  load(identity: string): Promise<ParsedSession>;
  remove(identity: string): Promise<void>;
}

export interface SessionLibraryOptions {
  /** Pass null to explicitly disable persistence, or a separate factory to isolate tests. */
  indexedDB?: IDBFactory | null;
  /** Primarily useful for isolated tests and future migrations. */
  databaseName?: string;
  now?: () => Date;
}

interface StoredSessionRecord extends SessionLibraryEntry {
  readonly recordVersion: typeof SESSION_LIBRARY_RECORD_VERSION;
  readonly serialized: string;
}

type FailureCode = Extract<SessionLibraryErrorCode, "transaction-failed" | "write-failed">;

const identityPattern = /^sha256:[0-9a-f]{64}$/;

function defaultIndexedDB(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB;
  } catch {
    return null;
  }
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

function isQuotaError(error: unknown): boolean {
  return errorName(error) === "QuotaExceededError";
}

function storageFailure(code: FailureCode, message: string, error: unknown): SessionLibraryError {
  if (error instanceof SessionLibraryError) return error;
  if (isQuotaError(error)) {
    return new SessionLibraryError("quota", "The local session library is out of storage space.", error);
  }
  return new SessionLibraryError(code, message, error);
}

function unavailable(message: string, cause?: unknown): SessionLibraryError {
  return new SessionLibraryError("unavailable", message, cause);
}

function factoryFrom(options: SessionLibraryOptions): IDBFactory {
  const factory = options.indexedDB === undefined ? defaultIndexedDB() : options.indexedDB;
  if (!factory) {
    throw unavailable("IndexedDB is unavailable; this browser cannot persist a local session library.");
  }
  return factory;
}

async function contentIdentity(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw unavailable("Web Crypto SHA-256 is unavailable; NarrowsLink cannot identify session content safely.");
  }

  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
  } catch (error) {
    throw unavailable("Web Crypto could not calculate the session content identity.", error);
  }
}

/** Returns the stable content identity used as the durable library key. */
export function sessionLibraryIdentity(document: SessionDocument): Promise<string> {
  return contentIdentity(encodeSessionDocument(validateSessionDocument(document)));
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName, SESSION_LIBRARY_DB_VERSION);
    } catch (error) {
      const code = errorName(error) === "SecurityError" ? "unavailable" : "open-failed";
      reject(new SessionLibraryError(code, "NarrowsLink could not open the local session library.", error));
      return;
    }

    let settled = false;
    let upgradeError: unknown;
    const fail = (error: SessionLibraryError): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        const store = database.objectStoreNames.contains(SESSION_LIBRARY_STORE_NAME)
          ? request.transaction?.objectStore(SESSION_LIBRARY_STORE_NAME)
          : database.createObjectStore(SESSION_LIBRARY_STORE_NAME, { keyPath: "identity" });
        if (!store) throw new Error("The session-library upgrade transaction is unavailable.");
        if (!store.indexNames.contains("savedAt")) store.createIndex("savedAt", "savedAt", { unique: false });
      } catch (error) {
        upgradeError = error;
        request.transaction?.abort();
      }
    };
    request.onerror = () => {
      fail(new SessionLibraryError(
        "open-failed",
        "NarrowsLink could not open the local session library.",
        upgradeError ?? request.error,
      ));
    };
    request.onblocked = () => {
      fail(new SessionLibraryError(
        "open-failed",
        "The local session library is blocked by another NarrowsLink window.",
      ));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function requestResult<T>(
  request: IDBRequest<T>,
  code: FailureCode,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageFailure(code, message, request.error));
  });
}

function startRequest<T>(
  start: () => IDBRequest<T>,
  code: FailureCode,
  message: string,
): Promise<T> {
  try {
    return requestResult(start(), code, message);
  } catch (error) {
    return Promise.reject(storageFailure(code, message, error));
  }
}

function transactionDone(
  transaction: IDBTransaction,
  code: FailureCode,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageFailure(code, message, transaction.error));
    transaction.onerror = () => {
      // The abort event owns the final failure because it carries the transaction outcome.
    };
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredSessionRecord(value: unknown): value is StoredSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<Record<keyof StoredSessionRecord, unknown>>;
  return record.recordVersion === SESSION_LIBRARY_RECORD_VERSION
    && typeof record.identity === "string"
    && identityPattern.test(record.identity)
    && typeof record.sessionId === "string"
    && typeof record.title === "string"
    && typeof record.startedAt === "string"
    && typeof record.displayTimeZone === "string"
    && isFiniteNumber(record.durationUs)
    && (record.formatVersion === 1 || record.formatVersion === 2)
    && (record.sourceKind === "udp" || record.sourceKind === "serial" || record.sourceKind === "file")
    && typeof record.sourceLabel === "string"
    && typeof record.decoderId === "string"
    && typeof record.decoderRevision === "string"
    && typeof record.decoderSchemaHash === "string"
    && (record.captureIntegrityStatus === "verified"
      || record.captureIntegrityStatus === "incomplete"
      || record.captureIntegrityStatus === "unknown")
    && isFiniteNumber(record.recordCount)
    && isFiniteNumber(record.byteLength)
    && typeof record.savedAt === "string"
    && Number.isFinite(Date.parse(record.savedAt))
    && typeof record.serialized === "string";
}

function assertStoredSessionRecord(value: unknown, identity?: string): StoredSessionRecord {
  if (!isStoredSessionRecord(value) || (identity !== undefined && value.identity !== identity)) {
    throw new SessionLibraryError(
      "corrupt",
      identity === undefined
        ? "The local session library contains invalid metadata."
        : "The stored session record is corrupt.",
    );
  }
  return value;
}

function freezeEntry(record: SessionLibraryEntry): SessionLibraryEntry {
  return Object.freeze({
    identity: record.identity,
    sessionId: record.sessionId,
    title: record.title,
    startedAt: record.startedAt,
    displayTimeZone: record.displayTimeZone,
    durationUs: record.durationUs,
    formatVersion: record.formatVersion,
    sourceKind: record.sourceKind,
    sourceLabel: record.sourceLabel,
    decoderId: record.decoderId,
    decoderRevision: record.decoderRevision,
    decoderSchemaHash: record.decoderSchemaHash,
    captureIntegrityStatus: record.captureIntegrityStatus,
    recordCount: record.recordCount,
    byteLength: record.byteLength,
    savedAt: record.savedAt,
  });
}

function entryFromDocument(
  document: SessionDocument,
  identity: string,
  serialized: string,
  savedAt: string,
): SessionLibraryEntry {
  return {
    identity,
    sessionId: document.id,
    title: document.title,
    startedAt: document.startedAt,
    displayTimeZone: document.displayTimeZone,
    durationUs: document.durationUs,
    formatVersion: document.formatVersion,
    sourceKind: document.source.kind,
    sourceLabel: document.source.label,
    decoderId: document.decoder.id,
    decoderRevision: document.decoder.revision,
    decoderSchemaHash: document.decoder.schemaHash,
    captureIntegrityStatus: document.formatVersion === 1 ? "unknown" : document.captureIntegrity.status,
    recordCount: document.records.length,
    byteLength: utf8ByteLength(serialized),
    savedAt,
  };
}

function recordMatchesEntry(record: StoredSessionRecord, entry: SessionLibraryEntry): boolean {
  return record.identity === entry.identity
    && record.sessionId === entry.sessionId
    && record.title === entry.title
    && record.startedAt === entry.startedAt
    && record.displayTimeZone === entry.displayTimeZone
    && record.durationUs === entry.durationUs
    && record.formatVersion === entry.formatVersion
    && record.sourceKind === entry.sourceKind
    && record.sourceLabel === entry.sourceLabel
    && record.decoderId === entry.decoderId
    && record.decoderRevision === entry.decoderRevision
    && record.decoderSchemaHash === entry.decoderSchemaHash
    && record.captureIntegrityStatus === entry.captureIntegrityStatus
    && record.recordCount === entry.recordCount
    && record.byteLength === entry.byteLength
    && record.savedAt === entry.savedAt;
}

function corruptRecord(message: string, cause?: unknown): SessionLibraryError {
  return new SessionLibraryError("corrupt", message, cause);
}

export function createSessionLibrary(options: SessionLibraryOptions = {}): SessionLibrary {
  const databaseName = options.databaseName ?? SESSION_LIBRARY_DB_NAME;
  const now = options.now ?? (() => new Date());

  const withDatabase = async <T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> => {
    const database = await openDatabase(factoryFrom(options), databaseName);
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  };

  return Object.freeze({
    async save(document: SessionDocument): Promise<SessionLibraryEntry> {
      // Serialize before the first await so caller mutations cannot change the stored bytes mid-save.
      const canonicalDocument = validateSessionDocument(document);
      const serialized = serializeSessionDocument(canonicalDocument);
      if (utf8ByteLength(serialized) > MAX_SESSION_FILE_BYTES) {
        throw new SessionLibraryError(
          "too-large",
          "The session exceeds the 32 MiB local-library safety limit and was not saved.",
        );
      }
      const identity = await contentIdentity(new TextEncoder().encode(serialized));
      const savedAt = now().toISOString();
      const newEntry = entryFromDocument(canonicalDocument, identity, serialized, savedAt);
      const newRecord: StoredSessionRecord = {
        recordVersion: SESSION_LIBRARY_RECORD_VERSION,
        ...newEntry,
        serialized,
      };

      return withDatabase(async (database) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(SESSION_LIBRARY_STORE_NAME, "readwrite");
        } catch (error) {
          throw storageFailure("transaction-failed", "NarrowsLink could not start a library write transaction.", error);
        }
        const completed = transactionDone(
          transaction,
          "write-failed",
          "NarrowsLink could not commit the session to the local library.",
        );
        const store = transaction.objectStore(SESSION_LIBRARY_STORE_NAME);

        let existingValue: unknown;
        try {
          existingValue = await startRequest(
            () => store.get(identity),
            "transaction-failed",
            "NarrowsLink could not inspect the local session library.",
          );
        } catch (error) {
          await completed.catch(() => undefined);
          throw error;
        }

        if (existingValue !== undefined) {
          await completed;
          const existing = assertStoredSessionRecord(existingValue, identity);
          const expected = entryFromDocument(canonicalDocument, identity, serialized, existing.savedAt);
          if (existing.serialized !== serialized || !recordMatchesEntry(existing, expected)) {
            throw corruptRecord("The existing session-library record does not match its content identity.");
          }
          return freezeEntry(existing);
        }

        await Promise.all([
          startRequest(
            () => store.add(newRecord),
            "write-failed",
            "NarrowsLink could not write the session to the local library.",
          ),
          completed,
        ]);
        return freezeEntry(newEntry);
      });
    },

    async list(): Promise<SessionLibraryEntry[]> {
      return withDatabase(async (database) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(SESSION_LIBRARY_STORE_NAME, "readonly");
        } catch (error) {
          throw storageFailure("transaction-failed", "NarrowsLink could not start a library read transaction.", error);
        }
        const store = transaction.objectStore(SESSION_LIBRARY_STORE_NAME);
        const [values] = await Promise.all([
          startRequest(
            () => store.getAll(),
            "transaction-failed",
            "NarrowsLink could not list the local session library.",
          ),
          transactionDone(
            transaction,
            "transaction-failed",
            "NarrowsLink could not finish listing the local session library.",
          ),
        ]);
        return values
          .map((value) => freezeEntry(assertStoredSessionRecord(value)))
          .sort((left, right) => {
            const bySavedAt = Date.parse(right.savedAt) - Date.parse(left.savedAt);
            return bySavedAt !== 0 ? bySavedAt : right.identity.localeCompare(left.identity);
          });
      });
    },

    async load(identity: string): Promise<ParsedSession> {
      const stored = await withDatabase(async (database) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(SESSION_LIBRARY_STORE_NAME, "readonly");
        } catch (error) {
          throw storageFailure("transaction-failed", "NarrowsLink could not start a library read transaction.", error);
        }
        const store = transaction.objectStore(SESSION_LIBRARY_STORE_NAME);
        const [value] = await Promise.all([
          startRequest(
            () => store.get(identity),
            "transaction-failed",
            "NarrowsLink could not read the requested stored session.",
          ),
          transactionDone(
            transaction,
            "transaction-failed",
            "NarrowsLink could not finish reading the requested stored session.",
          ),
        ]);
        if (value === undefined) {
          throw new SessionLibraryError("not-found", "The requested session is not in the local library.");
        }
        return assertStoredSessionRecord(value, identity);
      });

      const actualIdentity = await contentIdentity(new TextEncoder().encode(stored.serialized));
      if (actualIdentity !== identity) {
        throw corruptRecord("The stored session content does not match its SHA-256 identity.");
      }

      let input: unknown;
      try {
        input = JSON.parse(stored.serialized) as unknown;
      } catch (error) {
        throw corruptRecord("The stored session content is not valid JSON.", error);
      }

      let parsed: ParsedSession;
      try {
        parsed = parseSession(input);
      } catch (error) {
        throw corruptRecord("The stored session no longer passes NarrowsLink validation and decoding.", error);
      }

      const canonical = serializeSessionDocument(parsed.document);
      const expected = entryFromDocument(parsed.document, identity, canonical, stored.savedAt);
      if (canonical !== stored.serialized || !recordMatchesEntry(stored, expected)) {
        throw corruptRecord("The stored session content or metadata is not canonical.");
      }
      return parsed;
    },

    async remove(identity: string): Promise<void> {
      return withDatabase(async (database) => {
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(SESSION_LIBRARY_STORE_NAME, "readwrite");
        } catch (error) {
          throw storageFailure("transaction-failed", "NarrowsLink could not start a library delete transaction.", error);
        }
        const completed = transactionDone(
          transaction,
          "write-failed",
          "NarrowsLink could not commit the session deletion.",
        );
        const store = transaction.objectStore(SESSION_LIBRARY_STORE_NAME);
        let existing: unknown;
        try {
          existing = await startRequest(
            () => store.get(identity),
            "transaction-failed",
            "NarrowsLink could not inspect the requested stored session.",
          );
        } catch (error) {
          await completed.catch(() => undefined);
          throw error;
        }
        if (existing === undefined) {
          await completed;
          throw new SessionLibraryError("not-found", "The requested session is not in the local library.");
        }
        await Promise.all([
          startRequest(
            () => store.delete(identity),
            "write-failed",
            "NarrowsLink could not delete the requested stored session.",
          ),
          completed,
        ]);
      });
    },
  });
}
