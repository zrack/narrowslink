import type { SessionDocument } from "../domain/types";

export const MAX_SESSION_FILE_BYTES = 32 * 1024 * 1024;

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

/** The canonical local replay download is compact UTF-8 JSON with one trailing newline. */
export function serializeSessionDocument(document: SessionDocument): string {
  return `${JSON.stringify(document)}\n`;
}

export function encodeSessionDocument(document: SessionDocument): Uint8Array {
  return utf8Encoder.encode(serializeSessionDocument(document));
}

export function sessionDocumentFileByteLength(document: SessionDocument): number {
  return encodeSessionDocument(document).byteLength;
}
