import { MAX_INCIDENT_TITLE_LENGTH, type AuthoredIncidentRange, type Marker } from "../domain/types";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionWorkspaceContext {
  durationUs: number;
  reservedIncidentIds: readonly string[];
}

export interface SessionWorkspace {
  markers: Marker[];
  notes: string;
  authoredIncidentRanges: AuthoredIncidentRange[];
  updatedAt: string | null;
}

interface PersistedSessionWorkspaceV1 {
  version: 1;
  markers: Marker[];
  notes: string;
  updatedAt: string;
}

interface PersistedSessionWorkspaceV2 {
  version: 2;
  markers: Marker[];
  notes: string;
  authoredIncidentRanges: AuthoredIncidentRange[];
  updatedAt: string;
}

const LEGACY_STORAGE_PREFIX = "narrowslink:session-workspace:v1";
const STORAGE_PREFIX = "narrowslink:session-workspace:v2";
const MARKER_CATEGORIES = new Set<Marker["category"]>([
  "field-note",
  "observation",
  "maintenance",
]);
const INCIDENT_SEVERITIES = new Set<AuthoredIncidentRange["severity"]>([
  "info",
  "warning",
  "critical",
]);
const MAX_MARKERS = 1_000;
const MAX_NOTES_LENGTH = 20_000;
const MAX_AUTHORED_INCIDENT_RANGES = 100;
const MAX_INCIDENT_ID_LENGTH = 128;

const emptyWorkspace = (): SessionWorkspace => ({
  markers: [],
  notes: "",
  authoredIncidentRanges: [],
  updatedAt: null,
});

const defaultStorage = (): StorageLike | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const encodedSessionId = (sessionId: string): string | null => {
  const normalized = sessionId.trim();
  return normalized.length > 0
    ? Array.from(
        { length: normalized.length },
        (_, index) => normalized.charCodeAt(index).toString(16).padStart(4, "0"),
      ).join("")
    : null;
};

const workspaceKey = (prefix: string, sessionId: string): string | null => {
  const encoded = encodedSessionId(sessionId);
  return encoded === null ? null : `${prefix}:${encoded}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isWellFormedUnicode = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const isValidContext = (context: SessionWorkspaceContext): boolean =>
  Number.isSafeInteger(context.durationUs)
  && context.durationUs > 0
  && Array.isArray(context.reservedIncidentIds)
  && context.reservedIncidentIds.every((id) => typeof id === "string");

const isMarker = (
  value: unknown,
  context: SessionWorkspaceContext,
): value is Marker => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.offsetUs === "number" &&
    Number.isSafeInteger(value.offsetUs) &&
    value.offsetUs >= 0 &&
    value.offsetUs < context.durationUs &&
    typeof value.title === "string" &&
    typeof value.note === "string" &&
    typeof value.category === "string" &&
    MARKER_CATEGORIES.has(value.category as Marker["category"]) &&
    isValidTimestamp(value.createdAt)
  );
};

const isAuthoredIncidentRange = (
  value: unknown,
  context: SessionWorkspaceContext,
): value is AuthoredIncidentRange => {
  if (!isRecord(value)) {
    return false;
  }

  const createdAt = isValidTimestamp(value.createdAt) ? Date.parse(value.createdAt) : null;
  const updatedAt = isValidTimestamp(value.updatedAt) ? Date.parse(value.updatedAt) : null;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= MAX_INCIDENT_ID_LENGTH &&
    isWellFormedUnicode(value.id) &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    value.title.length <= MAX_INCIDENT_TITLE_LENGTH &&
    isWellFormedUnicode(value.title) &&
    typeof value.startUs === "number" &&
    Number.isSafeInteger(value.startUs) &&
    value.startUs >= 0 &&
    typeof value.endUs === "number" &&
    Number.isSafeInteger(value.endUs) &&
    value.endUs > value.startUs &&
    value.endUs <= context.durationUs &&
    typeof value.severity === "string" &&
    INCIDENT_SEVERITIES.has(value.severity as AuthoredIncidentRange["severity"]) &&
    createdAt !== null &&
    updatedAt !== null &&
    updatedAt >= createdAt
  );
};

const salvageMarkers = (
  values: unknown[],
  context: SessionWorkspaceContext,
): Marker[] => values.filter((value): value is Marker => isMarker(value, context)).slice(0, MAX_MARKERS);

const salvageAuthoredIncidentRanges = (
  values: unknown[],
  context: SessionWorkspaceContext,
): AuthoredIncidentRange[] => {
  const seenIds = new Set(context.reservedIncidentIds);
  const ranges: AuthoredIncidentRange[] = [];
  for (const value of values) {
    if (!isAuthoredIncidentRange(value, context) || seenIds.has(value.id)) continue;
    seenIds.add(value.id);
    ranges.push(value);
    if (ranges.length === MAX_AUTHORED_INCIDENT_RANGES) break;
  }
  return ranges;
};

const parseWorkspaceV1 = (
  raw: string,
  context: SessionWorkspaceContext,
): SessionWorkspace | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.markers) ||
    typeof value.notes !== "string" ||
    !isValidTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const persisted = value as unknown as PersistedSessionWorkspaceV1;
  return {
    markers: salvageMarkers(persisted.markers, context),
    notes: persisted.notes.slice(0, MAX_NOTES_LENGTH),
    authoredIncidentRanges: [],
    updatedAt: persisted.updatedAt,
  };
};

const parseWorkspaceV2 = (
  raw: string,
  context: SessionWorkspaceContext,
): SessionWorkspace | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !Array.isArray(value.markers) ||
    typeof value.notes !== "string" ||
    !Array.isArray(value.authoredIncidentRanges) ||
    !isValidTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const persisted = value as unknown as PersistedSessionWorkspaceV2;
  return {
    markers: salvageMarkers(persisted.markers, context),
    notes: persisted.notes.slice(0, MAX_NOTES_LENGTH),
    authoredIncidentRanges: salvageAuthoredIncidentRanges(persisted.authoredIncidentRanges, context),
    updatedAt: persisted.updatedAt,
  };
};

const usableStorage = (storage: StorageLike | null | undefined): StorageLike | null =>
  storage === undefined ? defaultStorage() : storage;

const readStoredValue = (storage: StorageLike, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const hasValidAuthoredIncidentRanges = (
  ranges: readonly AuthoredIncidentRange[],
  context: SessionWorkspaceContext,
): boolean => {
  if (ranges.length > MAX_AUTHORED_INCIDENT_RANGES) return false;
  const seenIds = new Set(context.reservedIncidentIds);
  for (const range of ranges) {
    if (!isAuthoredIncidentRange(range, context) || seenIds.has(range.id)) return false;
    seenIds.add(range.id);
  }
  return true;
};

export const loadSessionWorkspace = (
  sessionId: string,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): SessionWorkspace => {
  const currentKey = workspaceKey(STORAGE_PREFIX, sessionId);
  const legacyKey = workspaceKey(LEGACY_STORAGE_PREFIX, sessionId);
  const target = usableStorage(storage);
  if (currentKey === null || legacyKey === null || target === null || !isValidContext(context)) {
    return emptyWorkspace();
  }

  const currentRaw = readStoredValue(target, currentKey);
  if (currentRaw !== null) {
    const current = parseWorkspaceV2(currentRaw, context);
    if (current !== null) return current;
  }

  const legacyRaw = readStoredValue(target, legacyKey);
  if (legacyRaw !== null) {
    const legacy = parseWorkspaceV1(legacyRaw, context);
    if (legacy !== null) return legacy;
  }

  return emptyWorkspace();
};

export const saveSessionWorkspace = (
  sessionId: string,
  workspace: Pick<SessionWorkspace, "markers" | "notes" | "authoredIncidentRanges">,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): boolean => {
  const currentKey = workspaceKey(STORAGE_PREFIX, sessionId);
  const legacyKey = workspaceKey(LEGACY_STORAGE_PREFIX, sessionId);
  const target = usableStorage(storage);
  if (
    currentKey === null ||
    legacyKey === null ||
    target === null ||
    !isValidContext(context) ||
    !Array.isArray(workspace.markers) ||
    workspace.markers.length > MAX_MARKERS ||
    !workspace.markers.every((marker) => isMarker(marker, context)) ||
    typeof workspace.notes !== "string" ||
    workspace.notes.length > MAX_NOTES_LENGTH ||
    !Array.isArray(workspace.authoredIncidentRanges) ||
    !hasValidAuthoredIncidentRanges(workspace.authoredIncidentRanges, context)
  ) {
    return false;
  }

  const value: PersistedSessionWorkspaceV2 = {
    version: 2,
    markers: workspace.markers,
    notes: workspace.notes,
    authoredIncidentRanges: workspace.authoredIncidentRanges,
    updatedAt: new Date().toISOString(),
  };

  try {
    target.setItem(currentKey, JSON.stringify(value));
  } catch {
    return false;
  }

  try {
    target.removeItem(legacyKey);
  } catch {
    // The current value is durable; stale legacy cleanup can be retried later.
  }
  return true;
};

export const loadMarkers = (
  sessionId: string,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): Marker[] => loadSessionWorkspace(sessionId, context, storage).markers;

export const saveMarkers = (
  sessionId: string,
  markers: Marker[],
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): boolean => {
  const current = loadSessionWorkspace(sessionId, context, storage);
  return saveSessionWorkspace(sessionId, {
    markers,
    notes: current.notes,
    authoredIncidentRanges: current.authoredIncidentRanges,
  }, context, storage);
};

export const loadSessionNotes = (
  sessionId: string,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): string => loadSessionWorkspace(sessionId, context, storage).notes;

export const saveSessionNotes = (
  sessionId: string,
  notes: string,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): boolean => {
  const current = loadSessionWorkspace(sessionId, context, storage);
  return saveSessionWorkspace(sessionId, {
    markers: current.markers,
    notes,
    authoredIncidentRanges: current.authoredIncidentRanges,
  }, context, storage);
};

export const loadAuthoredIncidentRanges = (
  sessionId: string,
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): AuthoredIncidentRange[] => loadSessionWorkspace(sessionId, context, storage).authoredIncidentRanges;

export const saveAuthoredIncidentRanges = (
  sessionId: string,
  authoredIncidentRanges: AuthoredIncidentRange[],
  context: SessionWorkspaceContext,
  storage?: StorageLike | null,
): boolean => {
  const current = loadSessionWorkspace(sessionId, context, storage);
  return saveSessionWorkspace(sessionId, {
    markers: current.markers,
    notes: current.notes,
    authoredIncidentRanges,
  }, context, storage);
};

export const clearSessionWorkspace = (
  sessionId: string,
  storage?: StorageLike | null,
): boolean => {
  const currentKey = workspaceKey(STORAGE_PREFIX, sessionId);
  const legacyKey = workspaceKey(LEGACY_STORAGE_PREFIX, sessionId);
  const target = usableStorage(storage);
  if (currentKey === null || legacyKey === null || target === null) {
    return false;
  }

  let cleared = true;
  for (const key of [currentKey, legacyKey]) {
    try {
      target.removeItem(key);
    } catch {
      cleared = false;
    }
  }
  return cleared;
};
