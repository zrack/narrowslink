import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_ZIP_MAX_ENTRIES,
  EVIDENCE_ZIP_MAX_ENTRY_BYTES,
  EvidenceZipError,
  type EvidenceZipErrorCode,
  readEvidenceZip,
} from "./evidence-zip";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

interface ZipEntryOffsets {
  path: string;
  centralOffset: number;
  localOffset: number;
  centralNameOffset: number;
  localNameOffset: number;
  dataOffset: number;
}

interface ZipLayout {
  eocdOffset: number;
  centralDirectoryOffset: number;
  entries: ZipEntryOffsets[];
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint32(offset, true);
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  dataView(bytes).setUint16(offset, value, true);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  dataView(bytes).setUint32(offset, value, true);
}

function inspectZip(bytes: Uint8Array): ZipLayout {
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (readU32(bytes, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = readU16(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readU32(bytes, eocdOffset + 16);
  const entries: ZipEntryOffsets[] = [];
  let centralOffset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    expect(readU32(bytes, centralOffset)).toBe(CENTRAL_DIRECTORY_HEADER_SIGNATURE);
    const filenameLength = readU16(bytes, centralOffset + 28);
    const extraLength = readU16(bytes, centralOffset + 30);
    const commentLength = readU16(bytes, centralOffset + 32);
    const localOffset = readU32(bytes, centralOffset + 42);
    expect(readU32(bytes, localOffset)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    const localFilenameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const centralNameOffset = centralOffset + 46;
    const localNameOffset = localOffset + 30;
    const path = new TextDecoder().decode(
      bytes.subarray(centralNameOffset, centralNameOffset + filenameLength),
    );
    entries.push({
      path,
      centralOffset,
      localOffset,
      centralNameOffset,
      localNameOffset,
      dataOffset: localNameOffset + localFilenameLength + localExtraLength,
    });
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }

  return { eocdOffset, centralDirectoryOffset, entries };
}

function archive(
  entries: Record<string, Uint8Array | string>,
  level: 0 | 6 = 0,
): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, contents]) => [
        path,
        typeof contents === "string" ? strToU8(contents) : contents,
      ]),
    ),
    { level },
  );
}

function entry(layout: ZipLayout, path: string): ZipEntryOffsets {
  const result = layout.entries.find((candidate) => candidate.path === path);
  expect(result, `expected ZIP entry ${path}`).toBeDefined();
  return result as ZipEntryOffsets;
}

function replaceEntryPath(
  bytes: Uint8Array,
  offsets: ZipEntryOffsets,
  replacement: string,
): void {
  const replacementBytes = strToU8(replacement);
  expect(replacementBytes.byteLength).toBe(strToU8(offsets.path).byteLength);
  bytes.set(replacementBytes, offsets.centralNameOffset);
  bytes.set(replacementBytes, offsets.localNameOffset);
}

function insertBytes(bytes: Uint8Array, offset: number, inserted: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + inserted.byteLength);
  result.set(bytes.subarray(0, offset), 0);
  result.set(inserted, offset);
  result.set(bytes.subarray(offset), offset + inserted.byteLength);
  return result;
}

function expectZipError(bytes: Uint8Array, code: EvidenceZipErrorCode): EvidenceZipError {
  try {
    readEvidenceZip(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceZipError);
    expect((error as EvidenceZipError).code).toBe(code);
    return error as EvidenceZipError;
  }
  throw new Error(`Expected evidence ZIP error ${code}.`);
}

describe("readEvidenceZip", () => {
  it("extracts valid generated stored and DEFLATE entries", () => {
    const manifest = "m".repeat(4_096);
    const compressed = archive(
      {
        "manifest.json": manifest,
        SHA256SUMS: "abc  manifest.json\n",
      },
      6,
    );
    const layout = inspectZip(compressed);
    expect(readU16(compressed, entry(layout, "manifest.json").centralOffset + 10)).toBe(8);

    const extracted = readEvidenceZip(compressed);

    expect([...extracted.keys()]).toEqual(["manifest.json", "SHA256SUMS"]);
    expect(new TextDecoder().decode(extracted.get("manifest.json"))).toBe(manifest);
    expect(new TextDecoder().decode(extracted.get("SHA256SUMS"))).toBe(
      "abc  manifest.json\n",
    );
  });

  it("rejects duplicate canonical paths even when both headers agree", () => {
    const bytes = archive({
      "transport/provenance.json": "first",
      "raw/source-records.ndjson": "second",
    });
    const layout = inspectZip(bytes);
    replaceEntryPath(
      bytes,
      entry(layout, "raw/source-records.ndjson"),
      "transport/provenance.json",
    );

    expectZipError(bytes, "duplicate-path");
  });

  it.each([
    ["../escape.txt", "unsafe-path"],
    ["unknownx.json", "unknown-path"],
  ] as const)("rejects non-format entry path %s", (replacement, code) => {
    const bytes = archive({ "manifest.json": "{}" });
    replaceEntryPath(bytes, entry(inspectZip(bytes), "manifest.json"), replacement);

    expectZipError(bytes, code);
  });

  it("rejects payload bytes that no longer match the declared CRC-32", () => {
    const bytes = archive({ "manifest.json": "immutable" });
    const offsets = entry(inspectZip(bytes), "manifest.json");
    bytes[offsets.dataOffset] = (bytes[offsets.dataOffset] ?? 0) ^ 0x01;

    expectZipError(bytes, "crc32-mismatch");
  });

  it("rejects local and central metadata disagreement", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const offsets = entry(inspectZip(bytes), "manifest.json");
    writeU32(bytes, offsets.localOffset + 14, readU32(bytes, offsets.localOffset + 14) ^ 1);

    expectZipError(bytes, "central-local-mismatch");
  });

  it("rejects unsupported general-purpose flags", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const offsets = entry(inspectZip(bytes), "manifest.json");
    const unsupportedFlag = 1 << 5;
    writeU16(
      bytes,
      offsets.centralOffset + 8,
      readU16(bytes, offsets.centralOffset + 8) | unsupportedFlag,
    );
    writeU16(
      bytes,
      offsets.localOffset + 6,
      readU16(bytes, offsets.localOffset + 6) | unsupportedFlag,
    );

    expectZipError(bytes, "unsupported-flags");
  });

  it("rejects unsupported compression methods", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const offsets = entry(inspectZip(bytes), "manifest.json");
    writeU16(bytes, offsets.centralOffset + 10, 99);
    writeU16(bytes, offsets.localOffset + 8, 99);

    expectZipError(bytes, "unsupported-compression");
  });

  it("rejects a literal trailing suffix after the terminal ZIP record", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const withSuffix = insertBytes(bytes, bytes.byteLength, Uint8Array.of(0xde, 0xad));

    expectZipError(withSuffix, "eocd-not-found");
  });

  it("rejects a rebased archive prefix as unaccounted data", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const layout = inspectZip(bytes);
    const prefix = Uint8Array.of(0x4e, 0x4c, 0x42);
    const prefixed = insertBytes(bytes, 0, prefix);
    const shiftedEocdOffset = layout.eocdOffset + prefix.byteLength;
    writeU32(
      prefixed,
      shiftedEocdOffset + 16,
      layout.centralDirectoryOffset + prefix.byteLength,
    );
    for (const offsets of layout.entries) {
      writeU32(
        prefixed,
        offsets.centralOffset + prefix.byteLength + 42,
        offsets.localOffset + prefix.byteLength,
      );
    }

    expectZipError(prefixed, "unaccounted-data");
  });

  it("rejects unaccounted bytes between the central directory and terminal record", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const layout = inspectZip(bytes);
    const withGap = insertBytes(bytes, layout.eocdOffset, Uint8Array.of(0xfa, 0xce));

    expectZipError(withGap, "unaccounted-data");
  });

  it("rejects an oversized entry from metadata before allocating its claimed size", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const offsets = entry(inspectZip(bytes), "manifest.json");
    writeU32(bytes, offsets.centralOffset + 24, EVIDENCE_ZIP_MAX_ENTRY_BYTES + 1);

    expectZipError(bytes, "entry-too-large");
  });

  it("rejects an oversized total from metadata before inflating any entry", () => {
    const bytes = archive({
      "manifest.json": "{}",
      SHA256SUMS: "hashes",
      "transport/events.json": "events",
    });
    for (const offsets of inspectZip(bytes).entries) {
      writeU32(bytes, offsets.centralOffset + 24, EVIDENCE_ZIP_MAX_ENTRY_BYTES);
    }

    expectZipError(bytes, "total-size-exceeded");
  });

  it("rejects an excessive declared entry count before parsing entry bodies", () => {
    const bytes = archive({ "manifest.json": "{}" });
    const layout = inspectZip(bytes);
    writeU16(bytes, layout.eocdOffset + 8, EVIDENCE_ZIP_MAX_ENTRIES + 1);
    writeU16(bytes, layout.eocdOffset + 10, EVIDENCE_ZIP_MAX_ENTRIES + 1);

    expectZipError(bytes, "entry-count-exceeded");
  });
});
