import type { SessionLibraryEntry } from "./session-library";

export interface OperationGate {
  /** Starts a new operation and invalidates every previously issued token. */
  begin(): number;
  /** Returns true only while the token still owns the latest operation. */
  isCurrent(token: number): boolean;
}

/**
 * Coordinates asynchronous UI work without cancellation side effects.
 * A later operation invalidates earlier completions before they can replace current state.
 */
export function createOperationGate(): OperationGate {
  let currentToken = 0;
  return Object.freeze({
    begin(): number {
      currentToken += 1;
      return currentToken;
    },
    isCurrent(token: number): boolean {
      return token === currentToken;
    },
  });
}

export type CommittedSaveRefresh =
  | { readonly ok: true; readonly entries: readonly SessionLibraryEntry[] }
  | { readonly ok: false; readonly warning: string };

export interface CommittedSaveResolution {
  readonly entries: SessionLibraryEntry[];
  readonly warning: string | null;
}

/**
 * Resolves the list state after a save transaction has already committed.
 * A failed refresh must not hide that durable save, but its warning remains visible.
 */
export function resolveCommittedSave(
  currentEntries: readonly SessionLibraryEntry[],
  committedEntry: SessionLibraryEntry,
  refresh: CommittedSaveRefresh,
): CommittedSaveResolution {
  if (refresh.ok === true) {
    return { entries: [...refresh.entries], warning: null };
  }
  const entries = [
    committedEntry,
    ...currentEntries.filter((entry) => entry.identity !== committedEntry.identity),
  ];
  entries.sort((left, right) => {
    const bySavedAt = Date.parse(right.savedAt) - Date.parse(left.savedAt);
    return bySavedAt !== 0 ? bySavedAt : right.identity.localeCompare(left.identity);
  });
  return {
    entries,
    warning: refresh.warning,
  };
}
