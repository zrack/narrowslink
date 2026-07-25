import type { ParsedSession } from "../domain/types";

export interface CanonicalSessionArtifact {
  readonly blob: Blob;
  readonly identity: string;
  readonly byteLength: number;
  readonly sourceWasCanonical: boolean;
}

const artifacts = new WeakMap<ParsedSession, CanonicalSessionArtifact>();

export function registerCanonicalSessionArtifact(
  session: ParsedSession,
  artifact: CanonicalSessionArtifact,
): void {
  artifacts.set(session, Object.freeze(artifact));
}

export function canonicalSessionArtifact(
  session: ParsedSession,
): CanonicalSessionArtifact | null {
  return artifacts.get(session) ?? null;
}
