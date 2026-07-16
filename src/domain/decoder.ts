import type { DecodedField, DecodedFrame, FamilyId, SourceRecord } from "./types";

const SYNC_A = 0xa5;
const SYNC_B = 0x5a;
const PROTOCOL_VERSION = 1;
const HEADER_BYTES = 12;
const CHECKSUM_BYTES = 2;

const DECODER_ID = "NSL-01";
const DECODER_REVISION = "v1.3.7";

export const familyNames: Record<FamilyId, string> = {
  0x02: "Heartbeat",
  0x17: "Power",
  0x19: "Attitude",
  0x31: "Position",
  0x44: "Thermal",
};

/** Canonical, versioned byte-level schema used by both decoding and evidence export. */
export const DECODER_SCHEMA = Object.freeze({
  id: DECODER_ID,
  revision: DECODER_REVISION,
  byteOrder: "little-endian",
  checksum: "CRC-16/CCITT-FALSE over bytes [protocolVersion, checksum)",
  envelope: [
    { name: "sync", offset: 0, type: "uint16", byteOrder: "big-endian", fixedHex: "A55A" },
    { name: "protocolVersion", offset: 2, type: "uint8", fixed: 1 },
    { name: "familyId", offset: 3, type: "uint8" },
    { name: "sequence", offset: 4, type: "uint16" },
    { name: "payloadLength", offset: 6, type: "uint16", unit: "bytes" },
    { name: "deviceTimeMs", offset: 8, type: "uint32", unit: "ms" },
    { name: "payload", offset: 12, type: "bytes", lengthFrom: "payloadLength" },
    { name: "checksum", offsetFromEnd: 2, type: "uint16" },
  ],
  families: {
    "0x02": {
      name: "Heartbeat",
      payloadBytes: 8,
      fields: [
        { name: "uptime", offset: 0, type: "uint32", scale: 1, unit: "s" },
        { name: "mode", offset: 4, type: "uint8", enum: { 0: "Boot", 1: "Standby", 2: "Nominal", 3: "Safe" } },
        { name: "flags", offset: 5, type: "uint8", presentation: "hex" },
        { name: "decoderRevision", offset: 6, type: "uint16", scale: 1 },
      ],
    },
    "0x17": {
      name: "Power",
      payloadBytes: 9,
      fields: [
        { name: "busVoltage", offset: 0, type: "uint16", scale: 0.001, unit: "V" },
        { name: "busCurrent", offset: 2, type: "int16", scale: 0.001, unit: "A" },
        { name: "battery", offset: 4, type: "uint8", scale: 1, unit: "%", bounds: [0, 100] },
        { name: "boardTemp", offset: 5, type: "int16", scale: 0.01, unit: "°C" },
        { name: "inputVoltage", offset: 7, type: "uint16", scale: 0.001, unit: "V" },
      ],
    },
    "0x19": {
      name: "Attitude",
      payloadBytes: 16,
      fields: [
        { name: "roll", offset: 0, type: "int16", scale: 0.01, unit: "deg" },
        { name: "pitch", offset: 2, type: "int16", scale: 0.01, unit: "deg" },
        { name: "yaw", offset: 4, type: "int16", scale: 0.01, unit: "deg" },
        { name: "rollRate", offset: 6, type: "int16", scale: 0.01, unit: "deg/s" },
        { name: "pitchRate", offset: 8, type: "int16", scale: 0.01, unit: "deg/s" },
        { name: "yawRate", offset: 10, type: "int16", scale: 0.01, unit: "deg/s" },
        { name: "verticalAcceleration", offset: 12, type: "int16", scale: 0.001, unit: "g" },
        { name: "attitudeStatus", offset: 14, type: "uint16", presentation: "hex" },
      ],
    },
    "0x31": {
      name: "Position",
      payloadBytes: 24,
      fields: [
        { name: "latitude", offset: 0, type: "int32", scale: 1e-7, unit: "deg" },
        { name: "longitude", offset: 4, type: "int32", scale: 1e-7, unit: "deg" },
        { name: "altitude", offset: 8, type: "int32", scale: 0.001, unit: "m" },
        { name: "velocityNorth", offset: 12, type: "int16", scale: 0.01, unit: "m/s" },
        { name: "velocityEast", offset: 14, type: "int16", scale: 0.01, unit: "m/s" },
        { name: "velocityDown", offset: 16, type: "int16", scale: 0.01, unit: "m/s" },
        { name: "heading", offset: 18, type: "uint16", scale: 0.01, unit: "deg" },
        { name: "groundSpeed", offset: 20, type: "uint16", scale: 0.01, unit: "m/s" },
        { name: "fix", offset: 22, type: "uint8", scale: 1, bounds: [0, 4] },
        { name: "satellites", offset: 23, type: "uint8", scale: 1 },
      ],
    },
    "0x44": {
      name: "Thermal",
      payloadBytes: 10,
      fields: [
        { name: "avionicsTemp", offset: 0, type: "int16", scale: 0.01, unit: "°C" },
        { name: "radioTemp", offset: 2, type: "int16", scale: 0.01, unit: "°C" },
        { name: "batteryTemp", offset: 4, type: "int16", scale: 0.01, unit: "°C" },
        { name: "ambientTemp", offset: 6, type: "int16", scale: 0.01, unit: "°C" },
        { name: "fan", offset: 8, type: "uint8", scale: 1, unit: "%" },
        { name: "thermalStatus", offset: 9, type: "uint8", presentation: "hex" },
      ],
    },
  },
} as const);

/** SHA-256 of canonical DECODER_SCHEMA JSON (recursive code-unit key order, no whitespace). */
export const SUPPORTED_DECODER = Object.freeze({
  id: DECODER_ID,
  revision: DECODER_REVISION,
  schemaHash: "822aa1bf895ae52908913906ae853098a0527afa4925a134a9220847a6a9b9d4",
});

const familyPayloadBytes: Record<FamilyId, number> = {
  0x02: DECODER_SCHEMA.families["0x02"].payloadBytes,
  0x17: DECODER_SCHEMA.families["0x17"].payloadBytes,
  0x19: DECODER_SCHEMA.families["0x19"].payloadBytes,
  0x31: DECODER_SCHEMA.families["0x31"].payloadBytes,
  0x44: DECODER_SCHEMA.families["0x44"].payloadBytes,
};

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function crc16CcittFalse(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffff;
  for (let index = start; index < end; index += 1) {
    crc ^= (bytes[index] ?? 0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function field(
  name: string,
  raw: number | string | boolean,
  value: number | string | boolean | null,
  unit?: string,
  quality: DecodedField["quality"] = "valid",
): DecodedField {
  return { name, raw, value, unit, quality };
}

function decodeHeartbeat(view: DataView, offset: number): DecodedField[] {
  const modeNames = ["Boot", "Standby", "Nominal", "Safe"];
  const mode = view.getUint8(offset + 4);
  return [
    field("uptime", view.getUint32(offset, true), view.getUint32(offset, true), "s"),
    field("mode", mode, modeNames[mode] ?? `Unknown (${mode})`, undefined, mode < modeNames.length ? "valid" : "out-of-range"),
    field("flags", view.getUint8(offset + 5), `0x${view.getUint8(offset + 5).toString(16).padStart(2, "0")}`),
    field("decoderRevision", view.getUint16(offset + 6, true), view.getUint16(offset + 6, true)),
  ];
}

function decodePower(view: DataView, offset: number): DecodedField[] {
  const battery = view.getUint8(offset + 4);
  return [
    field("busVoltage", view.getUint16(offset, true), view.getUint16(offset, true) / 1000, "V"),
    field("busCurrent", view.getInt16(offset + 2, true), view.getInt16(offset + 2, true) / 1000, "A"),
    field("battery", battery, battery, "%", battery <= 100 ? "valid" : "out-of-range"),
    field("boardTemp", view.getInt16(offset + 5, true), view.getInt16(offset + 5, true) / 100, "°C"),
    field("inputVoltage", view.getUint16(offset + 7, true), view.getUint16(offset + 7, true) / 1000, "V"),
  ];
}

function decodeAttitude(view: DataView, offset: number): DecodedField[] {
  return [
    field("roll", view.getInt16(offset, true), view.getInt16(offset, true) / 100, "deg"),
    field("pitch", view.getInt16(offset + 2, true), view.getInt16(offset + 2, true) / 100, "deg"),
    field("yaw", view.getInt16(offset + 4, true), view.getInt16(offset + 4, true) / 100, "deg"),
    field("rollRate", view.getInt16(offset + 6, true), view.getInt16(offset + 6, true) / 100, "deg/s"),
    field("pitchRate", view.getInt16(offset + 8, true), view.getInt16(offset + 8, true) / 100, "deg/s"),
    field("yawRate", view.getInt16(offset + 10, true), view.getInt16(offset + 10, true) / 100, "deg/s"),
    field("verticalAcceleration", view.getInt16(offset + 12, true), view.getInt16(offset + 12, true) / 1000, "g"),
    field("attitudeStatus", view.getUint16(offset + 14, true), `0x${view.getUint16(offset + 14, true).toString(16).padStart(4, "0")}`),
  ];
}

function decodePosition(view: DataView, offset: number): DecodedField[] {
  const fix = view.getUint8(offset + 22);
  return [
    field("latitude", view.getInt32(offset, true), view.getInt32(offset, true) / 1e7, "deg"),
    field("longitude", view.getInt32(offset + 4, true), view.getInt32(offset + 4, true) / 1e7, "deg"),
    field("altitude", view.getInt32(offset + 8, true), view.getInt32(offset + 8, true) / 1000, "m"),
    field("velocityNorth", view.getInt16(offset + 12, true), view.getInt16(offset + 12, true) / 100, "m/s"),
    field("velocityEast", view.getInt16(offset + 14, true), view.getInt16(offset + 14, true) / 100, "m/s"),
    field("velocityDown", view.getInt16(offset + 16, true), view.getInt16(offset + 16, true) / 100, "m/s"),
    field("heading", view.getUint16(offset + 18, true), view.getUint16(offset + 18, true) / 100, "deg"),
    field("groundSpeed", view.getUint16(offset + 20, true), view.getUint16(offset + 20, true) / 100, "m/s"),
    field("fix", fix, fix, undefined, fix <= 4 ? "valid" : "out-of-range"),
    field("satellites", view.getUint8(offset + 23), view.getUint8(offset + 23)),
  ];
}

function decodeThermal(view: DataView, offset: number): DecodedField[] {
  return [
    field("avionicsTemp", view.getInt16(offset, true), view.getInt16(offset, true) / 100, "°C"),
    field("radioTemp", view.getInt16(offset + 2, true), view.getInt16(offset + 2, true) / 100, "°C"),
    field("batteryTemp", view.getInt16(offset + 4, true), view.getInt16(offset + 4, true) / 100, "°C"),
    field("ambientTemp", view.getInt16(offset + 6, true), view.getInt16(offset + 6, true) / 100, "°C"),
    field("fan", view.getUint8(offset + 8), view.getUint8(offset + 8), "%"),
    field("thermalStatus", view.getUint8(offset + 9), `0x${view.getUint8(offset + 9).toString(16).padStart(2, "0")}`),
  ];
}

const familyDecoders: Record<FamilyId, (view: DataView, offset: number) => DecodedField[]> = {
  0x02: decodeHeartbeat,
  0x17: decodePower,
  0x19: decodeAttitude,
  0x31: decodePosition,
  0x44: decodeThermal,
};

export function decodeRecord(record: SourceRecord, ordinal: number): DecodedFrame {
  const bytes = hexToBytes(record.dataHex);
  const base = {
    id: `frame-${record.id}`,
    ordinal,
    offsetUs: record.offsetUs,
    sourceRecord: record,
    familyName: "Unknown",
    fields: [] as DecodedField[],
  };

  if (bytes.length < HEADER_BYTES + CHECKSUM_BYTES) {
    return {
      ...base,
      integrity: { status: "truncated", reason: `Frame has ${bytes.length} bytes; expected at least ${HEADER_BYTES + CHECKSUM_BYTES}` },
      status: "partial",
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== SYNC_A || bytes[1] !== SYNC_B) {
    return {
      ...base,
      integrity: { status: "truncated", reason: "Sync word A55A is missing" },
      status: "partial",
    };
  }

  const protocolVersion = view.getUint8(2);
  const familyId = view.getUint8(3);
  const sequence = view.getUint16(4, true);
  const payloadLength = view.getUint16(6, true);
  const deviceTimeMs = view.getUint32(8, true);
  const expectedLength = HEADER_BYTES + payloadLength + CHECKSUM_BYTES;
  const familyName = familyNames[familyId as FamilyId] ?? `Unknown 0x${familyId.toString(16).padStart(2, "0")}`;
  const header = { protocolVersion, familyId, familyName, sequence, payloadLength, deviceTimeMs };

  if (expectedLength !== bytes.length) {
    return {
      ...base,
      ...header,
      integrity: { status: "invalid-length", reason: `Header declares ${expectedLength} bytes; received ${bytes.length}` },
      status: "invalid",
    };
  }

  const storedChecksum = view.getUint16(bytes.length - CHECKSUM_BYTES, true);
  const calculatedChecksum = crc16CcittFalse(bytes, 2, bytes.length - CHECKSUM_BYTES);
  if (storedChecksum !== calculatedChecksum) {
    return {
      ...base,
      ...header,
      integrity: { status: "crc-failed", expected: calculatedChecksum, actual: storedChecksum },
      status: "invalid",
    };
  }

  if (protocolVersion !== PROTOCOL_VERSION) {
    return {
      ...base,
      ...header,
      integrity: { status: "unsupported-version", reason: `Protocol version ${protocolVersion} is not supported; expected ${PROTOCOL_VERSION}` },
      status: "invalid",
    };
  }

  const decoder = familyDecoders[familyId as FamilyId];
  if (!decoder) {
    return {
      ...base,
      ...header,
      integrity: { status: "unknown-family", reason: `No decoder is registered for family 0x${familyId.toString(16).padStart(2, "0")}` },
      status: "invalid",
    };
  }

  const expectedPayloadBytes = familyPayloadBytes[familyId as FamilyId];
  if (payloadLength !== expectedPayloadBytes) {
    return {
      ...base,
      ...header,
      integrity: {
        status: "invalid-length",
        reason: `${familyName} payload declares ${payloadLength} bytes; schema requires ${expectedPayloadBytes}`,
      },
      status: "invalid",
    };
  }

  try {
    return {
      ...base,
      ...header,
      integrity: { status: "valid", checksum: storedChecksum },
      status: "complete",
      fields: decoder(view, HEADER_BYTES),
    };
  } catch (error) {
    return {
      ...base,
      ...header,
      integrity: { status: "truncated", reason: error instanceof Error ? error.message : "Payload could not be decoded" },
      status: "partial",
    };
  }
}

export interface EncodedFrameInput {
  familyId: FamilyId;
  sequence: number;
  deviceTimeMs: number;
  payload: Uint8Array;
  corruptChecksum?: boolean;
  omitSync?: boolean;
}

export function encodeFrame(input: EncodedFrameInput): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + input.payload.length + CHECKSUM_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = input.omitSync ? 0 : SYNC_A;
  bytes[1] = input.omitSync ? 0 : SYNC_B;
  view.setUint8(2, PROTOCOL_VERSION);
  view.setUint8(3, input.familyId);
  view.setUint16(4, input.sequence & 0xffff, true);
  view.setUint16(6, input.payload.length, true);
  view.setUint32(8, input.deviceTimeMs >>> 0, true);
  bytes.set(input.payload, HEADER_BYTES);
  const checksum = crc16CcittFalse(bytes, 2, bytes.length - CHECKSUM_BYTES);
  view.setUint16(bytes.length - CHECKSUM_BYTES, input.corruptChecksum ? checksum ^ 0xffff : checksum, true);
  return bytes;
}

export function getNumericField(frame: DecodedFrame, name: string): number | null {
  const value = frame.fields.find((candidate) => candidate.name === name)?.value;
  return typeof value === "number" ? value : null;
}
