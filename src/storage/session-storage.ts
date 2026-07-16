import type { Marker } from "../domain/types";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionWorkspace {
  markers: Marker[];
  notes: string;
  updatedAt: string | null;
}

interface PersistedSessionWorkspace {
  version: 1;
  markers: Marker[];
  notes: string;
  updatedAt: string;
}

const STORAGE_PREFIX = "narrowslink:session-workspace:v1";
const MARKER_CATEGORIES = new Set<Marker["category"]>([
  "field-note",
  "observation",
  "maintenance",
]);
const MAX_MARKERS = 1_000;
const MAX_NOTES_LENGTH = 20_000;

const emptyWorkspace = (): SessionWorkspace => ({
  markers: [],
  notes: "",
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

const workspaceKey = (sessionId: string): string | null => {
  const normalized = sessionId.trim();
  return normalized.length > 0
    ? `${STORAGE_PREFIX}:${Array.from({ length: normalized.length }, (_, index) => normalized.charCodeAt(index).toString(16).padStart(4, "0")).join("")}`
    : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMarker = (value: unknown): value is Marker => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.offsetUs === "number" &&
    Number.isSafeInteger(value.offsetUs) &&
    value.offsetUs >= 0 &&
    typeof value.title === "string" &&
    typeof value.note === "string" &&
    typeof value.category === "string" &&
    MARKER_CATEGORIES.has(value.category as Marker["category"]) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
};

const parseWorkspace = (raw: string): SessionWorkspace => {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.markers) ||
    typeof value.notes !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return emptyWorkspace();
  }

  const markers = value.markers.filter(isMarker).slice(0, MAX_MARKERS);
  return {
    markers,
    notes: value.notes.slice(0, MAX_NOTES_LENGTH),
    updatedAt: value.updatedAt,
  };
};

const usableStorage = (storage: StorageLike | null | undefined): StorageLike | null =>
  storage === undefined ? defaultStorage() : storage;

export const loadSessionWorkspace = (
  sessionId: string,
  storage?: StorageLike | null,
): SessionWorkspace => {
  const key = workspaceKey(sessionId);
  const target = usableStorage(storage);
  if (key === null || target === null) {
    return emptyWorkspace();
  }

  try {
    const raw = target.getItem(key);
    return raw === null ? emptyWorkspace() : parseWorkspace(raw);
  } catch {
    return emptyWorkspace();
  }
};

export const saveSessionWorkspace = (
  sessionId: string,
  workspace: Pick<SessionWorkspace, "markers" | "notes">,
  storage?: StorageLike | null,
): boolean => {
  const key = workspaceKey(sessionId);
  const target = usableStorage(storage);
  if (
    key === null ||
    target === null ||
    workspace.markers.length > MAX_MARKERS ||
    !workspace.markers.every(isMarker) ||
    workspace.notes.length > MAX_NOTES_LENGTH
  ) {
    return false;
  }

  const value: PersistedSessionWorkspace = {
    version: 1,
    markers: workspace.markers,
    notes: workspace.notes,
    updatedAt: new Date().toISOString(),
  };

  try {
    target.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const loadMarkers = (
  sessionId: string,
  storage?: StorageLike | null,
): Marker[] => loadSessionWorkspace(sessionId, storage).markers;

export const saveMarkers = (
  sessionId: string,
  markers: Marker[],
  storage?: StorageLike | null,
): boolean => {
  const current = loadSessionWorkspace(sessionId, storage);
  return saveSessionWorkspace(sessionId, { markers, notes: current.notes }, storage);
};

export const loadSessionNotes = (
  sessionId: string,
  storage?: StorageLike | null,
): string => loadSessionWorkspace(sessionId, storage).notes;

export const saveSessionNotes = (
  sessionId: string,
  notes: string,
  storage?: StorageLike | null,
): boolean => {
  const current = loadSessionWorkspace(sessionId, storage);
  return saveSessionWorkspace(sessionId, { markers: current.markers, notes }, storage);
};

export const clearSessionWorkspace = (
  sessionId: string,
  storage?: StorageLike | null,
): boolean => {
  const key = workspaceKey(sessionId);
  const target = usableStorage(storage);
  if (key === null || target === null) {
    return false;
  }

  try {
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
};
