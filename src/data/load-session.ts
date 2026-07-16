import { parseSession, SessionValidationError } from "../domain/session";
import type { ParsedSession } from "../domain/types";
import { MAX_SESSION_FILE_BYTES } from "./session-file";

export { MAX_SESSION_FILE_BYTES } from "./session-file";

export const DEFAULT_SESSION_URL = "/fixtures/harbor-relay-session.json";

export class SessionLoadError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "SessionLoadError";
    this.details = details;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SessionLoadError("The selected file is not valid JSON.", [
      error instanceof Error ? error.message : "JSON parsing failed",
    ]);
  }
}

function decodeUtf8(bytes: ArrayBuffer, sourceLabel: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SessionLoadError("The replay is not valid UTF-8 text.", [sourceLabel]);
  }
}

function parseValidated(text: string): ParsedSession {
  try {
    return parseSession(parseJson(text));
  } catch (error) {
    if (error instanceof SessionLoadError) throw error;
    if (error instanceof SessionValidationError) {
      throw new SessionLoadError(error.message, error.details);
    }
    throw new SessionLoadError("NarrowsLink could not decode this replay.", [
      error instanceof Error ? error.message : "Unknown decoder error",
    ]);
  }
}

export async function loadBundledSession(signal?: AbortSignal): Promise<ParsedSession> {
  const response = await fetch(DEFAULT_SESSION_URL, { signal });
  if (!response.ok) {
    throw new SessionLoadError("The bundled replay is unavailable.", [`HTTP ${response.status} ${response.statusText}`]);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SESSION_FILE_BYTES) {
    throw new SessionLoadError("The bundled replay exceeds the 32 MB safety limit.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_SESSION_FILE_BYTES) {
    throw new SessionLoadError("The bundled replay exceeds the 32 MB safety limit.");
  }
  return parseValidated(decodeUtf8(bytes, DEFAULT_SESSION_URL));
}

export async function loadSessionFile(file: File): Promise<ParsedSession> {
  if (file.size > MAX_SESSION_FILE_BYTES) {
    throw new SessionLoadError("The selected replay exceeds the 32 MB safety limit.", [file.name]);
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_SESSION_FILE_BYTES) {
    throw new SessionLoadError("The selected replay exceeds the 32 MB safety limit.", [file.name]);
  }
  return parseValidated(decodeUtf8(bytes, file.name));
}
