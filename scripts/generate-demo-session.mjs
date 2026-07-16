import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RECORD_COUNT = 18_402;
const DURATION_US = 8_435_000_000;
const FIRST_RECORD_US = 100_000;
const LAST_RECORD_US = DURATION_US - 100_000;
const SOURCE_ID = "harbor-relay-udp-9104";
const STARTED_AT = "2026-07-16T04:38:12.000Z";
const SECOND_US = 1_000_000;
const FADE_THROUGHPUT_DEPTH = 0.82;

const INCIDENTS = {
  fade: {
    id: "fade",
    title: "Link fade and recovery with decoder resync",
    startUs: 7_309_502_000,
    endUs: 7_459_884_000,
    severity: "critical",
  },
  interference: {
    id: "interference",
    title: "Interference burst with partial packet recovery",
    startUs: 2_372_090_000,
    endUs: 2_459_622_000,
    severity: "warning",
  },
  schema: {
    id: "schema",
    title: "Decoder schema change with clean reprocessing",
    startUs: 5_340_413_000,
    endUs: 5_416_041_000,
    severity: "info",
  },
};

const FAMILY = {
  heartbeat: 0x02,
  power: 0x17,
  attitude: 0x19,
  position: 0x31,
  thermal: 0x44,
};

const FAMILY_PATTERN = [
  FAMILY.position,
  FAMILY.attitude,
  FAMILY.power,
  FAMILY.position,
  FAMILY.thermal,
  FAMILY.attitude,
  FAMILY.position,
  FAMILY.heartbeat,
  FAMILY.power,
  FAMILY.position,
  FAMILY.attitude,
  FAMILY.position,
  FAMILY.thermal,
  FAMILY.power,
  FAMILY.position,
  FAMILY.heartbeat,
  FAMILY.attitude,
  FAMILY.position,
  FAMILY.power,
  FAMILY.position,
];

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(projectRoot, "public", "fixtures", "harbor-relay-session.json");

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 0) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function inRange(offsetUs, range) {
  return offsetUs >= range.startUs && offsetUs < range.endUs;
}

function rangeProgress(offsetUs, range) {
  return clamp((offsetUs - range.startUs) / (range.endUs - range.startUs), 0, 1);
}

function fadeEnvelope(offsetUs) {
  if (!inRange(offsetUs, INCIDENTS.fade)) return 0;
  return Math.sin(Math.PI * rangeProgress(offsetUs, INCIDENTS.fade)) ** 1.18;
}

function receptionWeight(offsetUs) {
  const seconds = offsetUs / SECOND_US;
  const naturalVariation = 1
    + 0.28 * Math.sin(seconds / 53)
    + 0.16 * Math.sin(seconds / 17)
    + 0.08 * Math.sin(seconds / 3.1);
  const fadeWeight = 1 - FADE_THROUGHPUT_DEPTH * fadeEnvelope(offsetUs);
  return Math.max(0.05, naturalVariation * fadeWeight);
}

function createRecordOffsets() {
  const bucketCount = Math.ceil(DURATION_US / SECOND_US);
  const cumulativeWeights = [0];
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const bucketStartUs = bucketIndex * SECOND_US;
    const bucketEndUs = Math.min(DURATION_US, bucketStartUs + SECOND_US);
    const midpointUs = bucketStartUs + (bucketEndUs - bucketStartUs) / 2;
    const weightedDuration = receptionWeight(midpointUs) * ((bucketEndUs - bucketStartUs) / SECOND_US);
    cumulativeWeights.push((cumulativeWeights.at(-1) ?? 0) + weightedDuration);
  }

  const totalWeight = cumulativeWeights.at(-1) ?? 0;
  const offsets = [];
  for (let index = 0; index < RECORD_COUNT; index += 1) {
    if (index === 0) {
      offsets.push(FIRST_RECORD_US);
      continue;
    }
    if (index === RECORD_COUNT - 1) {
      offsets.push(LAST_RECORD_US);
      continue;
    }

    const targetWeight = (index / (RECORD_COUNT - 1)) * totalWeight;
    let low = 0;
    let high = bucketCount - 1;
    while (low < high) {
      const midpoint = Math.floor((low + high) / 2);
      if ((cumulativeWeights[midpoint + 1] ?? totalWeight) < targetWeight) low = midpoint + 1;
      else high = midpoint;
    }

    const bucketWeightStart = cumulativeWeights[low] ?? 0;
    const bucketWeightEnd = cumulativeWeights[low + 1] ?? totalWeight;
    const bucketProgress = bucketWeightEnd > bucketWeightStart
      ? (targetWeight - bucketWeightStart) / (bucketWeightEnd - bucketWeightStart)
      : 0;
    const weightedOffsetUs = Math.round((low + bucketProgress) * SECOND_US);
    const previousOffsetUs = offsets.at(-1) ?? FIRST_RECORD_US;
    offsets.push(Math.max(
      previousOffsetUs + 1,
      Math.min(LAST_RECORD_US - (RECORD_COUNT - 1 - index), weightedOffsetUs),
    ));
  }
  return offsets;
}

function setInt16(view, offset, value) {
  view.setInt16(offset, clamp(Math.round(value), -32_768, 32_767), true);
}

function setUint16(view, offset, value) {
  view.setUint16(offset, clamp(Math.round(value), 0, 65_535), true);
}

function setInt32(view, offset, value) {
  view.setInt32(offset, clamp(Math.round(value), -2_147_483_648, 2_147_483_647), true);
}

function crc16CcittFalse(bytes, start = 0, end = bytes.length) {
  let crc = 0xffff;
  for (let index = start; index < end; index += 1) {
    crc ^= (bytes[index] ?? 0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function encodeFrame({ familyId, sequence, deviceTimeMs, payload, corruption }) {
  const bytes = new Uint8Array(12 + payload.length + 2);
  const view = new DataView(bytes.buffer);
  bytes[0] = corruption === "missing-sync" ? 0 : 0xa5;
  bytes[1] = corruption === "missing-sync" ? 0 : 0x5a;
  view.setUint8(2, 1);
  view.setUint8(3, familyId);
  view.setUint16(4, sequence & 0xffff, true);
  view.setUint16(6, payload.length, true);
  view.setUint32(8, deviceTimeMs >>> 0, true);
  bytes.set(payload, 12);
  const checksum = crc16CcittFalse(bytes, 2, bytes.length - 2);
  view.setUint16(bytes.length - 2, corruption === "crc" ? checksum ^ 0xffff : checksum, true);
  return corruption === "truncated" ? bytes.slice(0, bytes.length - 5) : bytes;
}

function makeHeartbeatPayload(offsetUs) {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  const uptimeSeconds = 18_420 + Math.floor(offsetUs / 1_000_000);
  const schemaRevision = offsetUs < INCIDENTS.schema.startUs + 31_000_000 ? 0x0136 : 0x0137;
  view.setUint32(0, uptimeSeconds, true);
  view.setUint8(4, 2);
  view.setUint8(5, inRange(offsetUs, INCIDENTS.fade) ? 0x05 : 0x01);
  view.setUint16(6, schemaRevision, true);
  return payload;
}

function makePowerPayload(seconds, fade) {
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  const busVoltageV = 12.42 - seconds / 240_000 - fade * 0.24 + Math.sin(seconds / 79) * 0.035;
  const busCurrentA = 1.84 + Math.sin(seconds / 16) * 0.34 + fade * 0.46;
  const batteryPct = 88 - (seconds / (DURATION_US / 1_000_000)) * 4;
  const boardTempC = 43.2 + Math.sin(seconds / 180) * 2.1 + fade * 3.6;
  const inputVoltageV = 13.08 + Math.sin(seconds / 121) * 0.07 - fade * 0.18;
  setUint16(view, 0, busVoltageV * 1000);
  setInt16(view, 2, busCurrentA * 1000);
  view.setUint8(4, clamp(Math.round(batteryPct), 0, 100));
  setInt16(view, 5, boardTempC * 100);
  setUint16(view, 7, inputVoltageV * 1000);
  return payload;
}

function makeAttitudePayload(seconds, fade) {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  const roll = Math.sin(seconds / 11.2) * 7.8 + Math.sin(seconds / 2.9) * 0.8;
  const pitch = Math.cos(seconds / 13.8) * 5.4 + fade * 1.7;
  const yaw = ((seconds * 2.7) % 360) - 180;
  const rollRate = Math.cos(seconds / 11.2) * 0.7;
  const pitchRate = -Math.sin(seconds / 13.8) * 0.4;
  const yawRate = 2.7 + Math.sin(seconds / 7.1) * 0.18;
  const verticalAcceleration = 1 + Math.sin(seconds / 4.5) * 0.035 + fade * 0.018;
  setInt16(view, 0, roll * 100);
  setInt16(view, 2, pitch * 100);
  setInt16(view, 4, yaw * 100);
  setInt16(view, 6, rollRate * 100);
  setInt16(view, 8, pitchRate * 100);
  setInt16(view, 10, yawRate * 100);
  setInt16(view, 12, verticalAcceleration * 1000);
  view.setUint16(14, fade > 0.75 ? 0x0003 : 0x0001, true);
  return payload;
}

function makePositionPayload(seconds, fade) {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  const latitude = 47.267 + Math.sin(seconds / 310) * 0.018 + Math.sin(seconds / 29) * 0.0016 - fade * 0.01;
  const longitude = -122.55 + Math.cos(seconds / 326) * 0.025 + Math.sin(seconds / 33) * 0.0019 - fade * 0.012;
  const altitudeM = 185 + Math.sin(seconds / 103) * 128 + Math.sin(seconds / 7.8) * 4.5 + fade * 32;
  const velocityNorth = 14.2 + Math.sin(seconds / 18) * 3.2;
  const velocityEast = 7.8 + Math.cos(seconds / 21) * 2.4;
  const velocityDown = Math.sin(seconds / 12) * 0.9;
  const heading = (42 + seconds * 0.31) % 360;
  const groundSpeed = Math.hypot(velocityNorth, velocityEast);
  setInt32(view, 0, latitude * 1e7);
  setInt32(view, 4, longitude * 1e7);
  setInt32(view, 8, altitudeM * 1000);
  setInt16(view, 12, velocityNorth * 100);
  setInt16(view, 14, velocityEast * 100);
  setInt16(view, 16, velocityDown * 100);
  setUint16(view, 18, heading * 100);
  setUint16(view, 20, groundSpeed * 100);
  view.setUint8(22, fade > 0.9 ? 2 : 3);
  view.setUint8(23, clamp(Math.round(13 - fade * 5 + Math.sin(seconds / 65)), 5, 18));
  return payload;
}

function makeThermalPayload(seconds, fade) {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  const ambientTempC = 18.4 + Math.sin(seconds / 420) * 2.8;
  const radioTempC = 47.8 + Math.sin(seconds / 170) * 2.4 + fade * 7.1;
  const avionicsTempC = 42.6 + Math.sin(seconds / 230) * 1.9 + fade * 2.8;
  const batteryTempC = 35.3 + Math.cos(seconds / 310) * 1.4 + fade * 1.6;
  setInt16(view, 0, avionicsTempC * 100);
  setInt16(view, 2, radioTempC * 100);
  setInt16(view, 4, batteryTempC * 100);
  setInt16(view, 6, ambientTempC * 100);
  view.setUint8(8, clamp(Math.round(34 + fade * 48 + Math.sin(seconds / 41) * 4), 0, 100));
  view.setUint8(9, fade > 0.82 ? 0x03 : 0x01);
  return payload;
}

function makePayload(familyId, offsetUs) {
  const seconds = offsetUs / 1_000_000;
  const fade = fadeEnvelope(offsetUs);
  switch (familyId) {
    case FAMILY.heartbeat:
      return makeHeartbeatPayload(offsetUs);
    case FAMILY.power:
      return makePowerPayload(seconds, fade);
    case FAMILY.attitude:
      return makeAttitudePayload(seconds, fade);
    case FAMILY.position:
      return makePositionPayload(seconds, fade);
    case FAMILY.thermal:
      return makeThermalPayload(seconds, fade);
    default:
      throw new Error(`Unsupported family ${familyId}`);
  }
}

function corruptionAt(offsetUs, recordIndex) {
  const fadeElapsed = (offsetUs - INCIDENTS.fade.startUs) / 1_000_000;
  if (fadeElapsed >= 55 && fadeElapsed < 60) {
    return ["crc", "missing-sync", "truncated"][recordIndex % 3];
  }
  if (fadeElapsed >= 94 && fadeElapsed < 99) {
    return recordIndex % 2 === 0 ? "crc" : "missing-sync";
  }

  const interferenceElapsed = (offsetUs - INCIDENTS.interference.startUs) / 1_000_000;
  if (interferenceElapsed >= 18.9 && interferenceElapsed < 20.3) {
    return recordIndex % 2 === 0 ? "missing-sync" : "truncated";
  }
  return null;
}

function missingSequenceCount(offsetUs, recordIndex) {
  const fade = fadeEnvelope(offsetUs);
  if (fade > 0.26 && recordIndex % 11 === 3) return fade > 0.78 && recordIndex % 33 === 3 ? 2 : 1;
  if (inRange(offsetUs, INCIDENTS.interference) && recordIndex % 79 === 12) return 1;
  return 0;
}

function linkSignal(offsetUs, recordIndex) {
  const seconds = offsetUs / 1_000_000;
  const fade = fadeEnvelope(offsetUs);
  const inInterference = inRange(offsetUs, INCIDENTS.interference);
  const interferenceNoise = inInterference
    ? Math.sin(recordIndex * 2.73) * 7.8 + Math.sin(recordIndex * 0.61) * 3.2
    : 0;
  const rssi = -66.4
    + Math.sin(seconds / 47) * 1.4
    + Math.sin(recordIndex * 0.37) * 0.8
    - fade * 29.8
    + interferenceNoise;
  const snr = 20.8 - fade * 27 + interferenceNoise * 0.35 + Math.sin(recordIndex * 0.23) * 1.1;
  return {
    rssiDbm: round(clamp(rssi, -108, -48), 1),
    snrDb: round(clamp(snr, -12, 28), 1),
    provenance: "gateway-sidecar",
  };
}

function transitDelayMs(offsetUs, recordIndex) {
  const seconds = offsetUs / 1_000_000;
  const fade = fadeEnvelope(offsetUs);
  const interference = inRange(offsetUs, INCIDENTS.interference) ? 1 : 0;
  const fadeJitter = fade * (54 + Math.sin(recordIndex * 2.21) * 83 + Math.sin(recordIndex * 0.53) * 29);
  const interferenceJitter = interference * (28 + Math.sin(recordIndex * 2.9) * 66);
  return clamp(12 + Math.sin(seconds / 8.2) * 2.4 + fadeJitter + interferenceJitter, -42, 196);
}

function createFixture() {
  const records = [];
  const recordOffsets = createRecordOffsets();
  let nextSequence = 40_000;
  let kernelDropCounter = 0;

  for (let index = 0; index < RECORD_COUNT; index += 1) {
    const offsetUs = recordOffsets[index];
    if (offsetUs == null) throw new Error(`Missing generated offset for record ${index}`);
    const familyId = FAMILY_PATTERN[index % FAMILY_PATTERN.length];
    const missedSequences = missingSequenceCount(offsetUs, index);
    nextSequence = (nextSequence + missedSequences) & 0xffff;
    kernelDropCounter += missedSequences;

    const delayMs = transitDelayMs(offsetUs, index);
    const deviceTimeMs = Math.max(0, Math.round(offsetUs / 1000 - delayMs));
    const corruption = corruptionAt(offsetUs, index);
    const frame = encodeFrame({
      familyId,
      sequence: nextSequence,
      deviceTimeMs,
      payload: makePayload(familyId, offsetUs),
      corruption,
    });
    const dataHex = bytesToHex(frame);

    records.push({
      id: `harbor-${String(index + 1).padStart(6, "0")}`,
      index,
      sourceId: SOURCE_ID,
      offsetUs,
      dataHex,
      captureBytes: frame.length,
      wireBytes: frame.length + 42,
      transport: {
        kind: "udp",
        kernelDropCounter,
      },
      signal: linkSignal(offsetUs, index),
    });

    nextSequence = (nextSequence + 1) & 0xffff;
  }

  return {
    format: "narrowslink/session",
    formatVersion: 1,
    id: "harbor-relay-2026-07-15-213812",
    title: "Harbor relay downlink",
    startedAt: STARTED_AT,
    displayTimeZone: "America/Los_Angeles",
    durationUs: DURATION_US,
    source: {
      id: SOURCE_ID,
      kind: "udp",
      label: "Harbor relay downlink · UDP :9104",
      address: "239.42.91.4",
      port: 9104,
    },
    decoder: {
      id: "NSL-01",
      revision: "v1.3.7",
      schemaHash: "822aa1bf895ae52908913906ae853098a0527afa4925a134a9220847a6a9b9d4",
    },
    records,
    incidents: [INCIDENTS.fade, INCIDENTS.interference, INCIDENTS.schema],
  };
}

function validateFixture(fixture) {
  if (fixture.durationUs !== DURATION_US) throw new Error("Fixture duration changed unexpectedly");
  if (fixture.records.length !== RECORD_COUNT) throw new Error("Fixture record count changed unexpectedly");

  const ids = new Set();
  const families = new Set();
  let previousOffset = -1;
  let malformedRecords = 0;
  for (const record of fixture.records) {
    if (ids.has(record.id)) throw new Error(`Duplicate record ID: ${record.id}`);
    ids.add(record.id);
    if (record.offsetUs <= previousOffset) throw new Error(`Non-monotonic offset at ${record.id}`);
    if (record.offsetUs >= DURATION_US) throw new Error(`Out-of-range offset at ${record.id}`);
    if (record.captureBytes !== record.dataHex.length / 2) throw new Error(`Byte-count mismatch at ${record.id}`);
    if (!/^(?:[0-9A-F]{2})+$/.test(record.dataHex)) throw new Error(`Invalid hex at ${record.id}`);
    if (record.dataHex.startsWith("A55A")) families.add(record.dataHex.slice(6, 8));
    if (!record.dataHex.startsWith("A55A") || record.captureBytes < 22) malformedRecords += 1;
    previousOffset = record.offsetUs;
  }
  if (families.size !== 5) throw new Error(`Expected all five packet families; found ${families.size}`);
  if (malformedRecords === 0) throw new Error("Fixture does not include inspectable malformed records");

  const firstRecord = fixture.records[0];
  const lastRecord = fixture.records.at(-1);
  if (firstRecord?.offsetUs !== FIRST_RECORD_US || lastRecord?.offsetUs !== LAST_RECORD_US) {
    throw new Error("Fixture endpoints changed unexpectedly");
  }

  const fadeCenterUs = (INCIDENTS.fade.startUs + INCIDENTS.fade.endUs) / 2;
  const centerStartUs = fadeCenterUs - 15 * SECOND_US;
  const centerEndUs = fadeCenterUs + 15 * SECOND_US;
  const shoulderRanges = [
    [INCIDENTS.fade.startUs - 60 * SECOND_US, INCIDENTS.fade.startUs],
    [INCIDENTS.fade.endUs, INCIDENTS.fade.endUs + 60 * SECOND_US],
  ];
  const centerRate = fixture.records.filter((record) => record.offsetUs >= centerStartUs && record.offsetUs < centerEndUs).length / 30;
  const shoulderFrames = fixture.records.filter((record) => shoulderRanges.some(
    ([startUs, endUs]) => record.offsetUs >= startUs && record.offsetUs < endUs,
  )).length;
  const shoulderRate = shoulderFrames / 120;
  if (shoulderRate < centerRate * 2.5) {
    throw new Error(`Expected visible throughput fade; shoulders ${shoulderRate.toFixed(2)} pkt/s, center ${centerRate.toFixed(2)} pkt/s`);
  }

  const overviewRates = [];
  for (let startUs = 0; startUs < DURATION_US; startUs += 20 * SECOND_US) {
    const endUs = Math.min(DURATION_US, startUs + 20 * SECOND_US);
    const recordsInWindow = fixture.records.filter((record) => record.offsetUs >= startUs && record.offsetUs < endUs).length;
    overviewRates.push(recordsInWindow / ((endUs - startUs) / SECOND_US));
  }
  const sortedOverviewRates = [...overviewRates].sort((left, right) => left - right);
  const medianOverviewRate = sortedOverviewRates[Math.floor(sortedOverviewRates.length / 2)] ?? 0;
  const maximumOverviewRate = sortedOverviewRates.at(-1) ?? 0;
  if (medianOverviewRate <= 0 || maximumOverviewRate > medianOverviewRate * 1.75) {
    throw new Error(`Expected broadly distributed overview throughput; median ${medianOverviewRate.toFixed(2)} pkt/s, maximum ${maximumOverviewRate.toFixed(2)} pkt/s`);
  }

  const fadeRecords = fixture.records.filter((record) => inRange(record.offsetUs, INCIDENTS.fade));
  const precedingFadeRecord = fixture.records.findLast((record) => record.offsetUs < INCIDENTS.fade.startUs);
  const fadeMissing = (fadeRecords.at(-1)?.transport.kernelDropCounter ?? 0)
    - (precedingFadeRecord?.transport.kernelDropCounter ?? 0);
  const fadeLossPct = (fadeMissing / (fadeRecords.length + fadeMissing)) * 100;
  if (fadeLossPct < 4 || fadeLossPct > 8) {
    throw new Error(`Expected a bounded fade loss envelope; observed ${fadeLossPct.toFixed(2)}%`);
  }

  const corruptionWindows = [
    [INCIDENTS.fade.startUs + 55_000_000, INCIDENTS.fade.startUs + 60_000_000],
    [INCIDENTS.fade.startUs + 94_000_000, INCIDENTS.fade.startUs + 99_000_000],
    [INCIDENTS.interference.startUs + 18_900_000, INCIDENTS.interference.startUs + 20_300_000],
  ];
  for (const [startUs, endUs] of corruptionWindows) {
    const recordsInWindow = fixture.records.filter((record) => record.offsetUs >= startUs && record.offsetUs < endUs).length;
    if (recordsInWindow < 2) throw new Error(`Corruption window ${startUs}-${endUs} contains fewer than two records`);
  }
}

const fixture = createFixture();
validateFixture(fixture);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture)}\n`, "utf8");

const firstRecord = fixture.records[0];
const lastRecord = fixture.records.at(-1);
const finalDropCount = lastRecord?.transport.kernelDropCounter ?? 0;
console.log(`Generated ${fixture.records.length.toLocaleString("en-US")} records at ${outputPath}`);
console.log(`Offsets: ${firstRecord.offsetUs}–${lastRecord.offsetUs} µs; declared duration: ${fixture.durationUs} µs`);
console.log(`Sequence gaps represented by kernel drop counter: ${finalDropCount}`);
