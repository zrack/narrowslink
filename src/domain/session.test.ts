import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  encodeFrame,
  NMEA0183_DECODER_PACK,
  SUPPORTED_DECODER,
} from "./decoder";
import { decoderDescriptorForPack } from "./decoder-pack";
import {
  parseSession,
  projectIncident,
  rowsInRange,
  SessionValidationError,
  validateIncidentPreset,
  validateSessionDocument,
} from "./session";
import {
  MAX_SESSION_DURATION_US,
  type CaptureIntegrityReceipt,
  type DiagnosticEvent,
  type FamilyId,
  type IncidentPreset,
  type SessionDocument,
  type SessionDocumentV2,
  type SourceRecord,
  type TransportEvent,
  type UdpBridgeJournal,
} from "./types";

function payloadFor(familyId: FamilyId): Uint8Array {
  const sizes: Record<FamilyId, number> = { 0x02: 8, 0x17: 9, 0x19: 16, 0x31: 24, 0x44: 10 };
  const payload = new Uint8Array(sizes[familyId]);
  if (familyId === 0x31) {
    const view = new DataView(payload.buffer);
    view.setInt32(0, 472_672_000, true);
    view.setInt32(4, -1_225_514_000, true);
    view.setInt32(8, 184_000, true);
    view.setUint8(22, 3);
    view.setUint8(23, 10);
  }
  return payload;
}

function record(index: number, offsetUs: number, sequence: number, familyId: FamilyId, corruptChecksum = false): SourceRecord {
  const bytes = encodeFrame({
    familyId,
    sequence,
    deviceTimeMs: Math.floor(offsetUs / 1000),
    payload: payloadFor(familyId),
    corruptChecksum,
  });
  return {
    id: `record-${index}`,
    index,
    sourceId: "harbor-udp",
    offsetUs,
    dataHex: bytesToHex(bytes),
    captureBytes: bytes.length,
    wireBytes: bytes.length,
    transport: { kind: "udp" },
    signal: { rssiDbm: offsetUs < 2_000_000 ? -68 : -96, provenance: "gateway-sidecar" },
  };
}

function document(): SessionDocument {
  return {
    format: "narrowslink/session",
    formatVersion: 1,
    id: "session-test",
    title: "Harbor relay downlink",
    startedAt: "2026-07-16T04:38:12.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs: 6_000_000,
    source: { id: "harbor-udp", kind: "udp", label: "UDP :9104", address: "127.0.0.1", port: 9104 },
    decoder: { ...SUPPORTED_DECODER },
    records: [
      record(0, 0, 10, 0x31),
      record(1, 1_000_000, 11, 0x17),
      record(2, 2_000_000, 14, 0x44, true),
      record(3, 3_000_000, 15, 0x19),
      record(4, 4_000_000, 16, 0x02),
    ],
    incidents: [{ id: "fade", title: "Fade", startUs: 1_000_000, endUs: 5_000_000, severity: "critical" }],
  };
}

function retainedBytes(session: SessionDocument): number {
  return session.records.reduce((total, sourceRecord) => total + sourceRecord.captureBytes, 0);
}

function verifiedUdpReceipt(session: SessionDocument): CaptureIntegrityReceipt {
  const bytes = retainedBytes(session);
  return {
    schemaVersion: 1,
    status: "verified",
    assessmentBasis: "udp-bridge-reconciled",
    stopDisposition: "confirmed",
    stopOffsetUs: session.durationUs,
    eventLogComplete: true,
    input: {
      unit: "datagram",
      observedUnits: session.records.length,
      observedBytes: bytes,
      transportReportedUnits: session.records.length,
      transportReportedBytes: bytes,
    },
    retained: { records: session.records.length, bytes },
    issueCodes: [],
  };
}

function v2Document(): SessionDocumentV2 {
  const legacy = document();
  return {
    ...legacy,
    formatVersion: 2,
    transportEvents: [],
    captureIntegrity: verifiedUdpReceipt(legacy),
  };
}

function cleanUdpJournal(replay: SessionDocumentV2): UdpBridgeJournal {
  const bytes = retainedBytes(replay);
  const endedAt = "2026-07-16T04:38:18.000Z";
  return {
    captureId: "session-test-bridge",
    startedAt: replay.startedAt,
    endedAt,
    state: "clean",
    bind: {
      requestedHost: "127.0.0.1",
      requestedPort: 0,
      host: "127.0.0.1",
      port: 9_104,
      family: "IPv4",
    },
    multicast: null,
    datagrams: replay.records.length,
    bytes,
    kernelDroppedDatagrams: null,
    kernelDroppedDatagramsSource: "unavailable",
    entriesComplete: true,
    omittedEntries: 0,
    entries: [
      {
        sequence: 0,
        type: "capture-started",
        at: replay.startedAt,
        offsetUs: 0,
        datagrams: 0,
        bytes: 0,
      },
      {
        sequence: 1,
        type: "capture-stopped",
        at: endedAt,
        offsetUs: replay.durationUs,
        datagrams: replay.records.length,
        bytes,
      },
    ],
  };
}

function v2DocumentWithVerifiedUdpProvenance(): SessionDocumentV2 {
  const replay = v2Document();
  const endpoint = { address: "192.0.2.44", port: 55_555, family: "IPv4" as const };
  for (const sourceRecord of replay.records) {
    sourceRecord.transport.remoteEndpoint = { ...endpoint };
    sourceRecord.transport.kernelDropCounter = null;
  }
  replay.transportProvenance = {
    schemaVersion: 1,
    transport: "udp",
    sourceId: replay.source.id,
    status: "verified",
    issueCodes: ["udp-kernel-drop-counter-unavailable"],
    journal: cleanUdpJournal(replay),
    endpointAttribution: {
      totalRecords: replay.records.length,
      attributedRecords: replay.records.length,
      unattributedRecords: 0,
      distinctEndpoints: [endpoint],
    },
  };
  return replay;
}

function v2SerialDocument(): SessionDocumentV2 {
  const replay = v2Document();
  const bytes = retainedBytes(replay);
  replay.source = { id: "harbor-udp", kind: "serial", label: "Serial loopback" };
  for (const sourceRecord of replay.records) sourceRecord.transport = { kind: "serial" };
  replay.captureIntegrity = {
    ...replay.captureIntegrity,
    assessmentBasis: "web-serial-observed",
    input: {
      unit: "serial-read",
      observedUnits: replay.records.length,
      observedBytes: bytes,
      transportReportedUnits: null,
      transportReportedBytes: null,
    },
  };
  return replay;
}

function v2FileDocument(): SessionDocumentV2 {
  const replay = v2Document();
  const bytes = retainedBytes(replay);
  replay.source = { id: "harbor-udp", kind: "file", label: "Imported capture" };
  for (const sourceRecord of replay.records) sourceRecord.transport = { kind: "file" };
  replay.captureIntegrity = {
    schemaVersion: 1,
    status: "unknown",
    assessmentBasis: "file-source-unassessed",
    stopDisposition: "not-observed",
    stopOffsetUs: null,
    eventLogComplete: false,
    input: {
      unit: "unknown",
      observedUnits: null,
      observedBytes: null,
      transportReportedUnits: null,
      transportReportedBytes: null,
    },
    retained: { records: replay.records.length, bytes },
    issueCodes: ["file-source-unassessed"],
  };
  return replay;
}

function v2DocumentWithTransportEvents(): SessionDocumentV2 {
  const replay = v2Document();
  const bytes = retainedBytes(replay);
  const transportEvents = [
    {
      id: "udp-sequence-gap-1",
      index: 0,
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 1_000_000 },
      severity: "critical",
      message: "SSE sequence 12 arrived where 11 was expected.",
      expectedSequence: 11,
      observedSequence: 12,
    },
    {
      id: "capture-backpressure-1",
      index: 1,
      type: "capture-backpressure",
      transport: "udp",
      scope: { kind: "interval", startUs: 2_000_000, endUs: 3_000_000 },
      severity: "critical",
      message: "The recorder paused while its local byte budget was exhausted.",
      component: "recorder",
      limit: "captured-bytes",
      limitValue: bytes,
      observedValue: bytes + 1,
    },
    {
      id: "udp-counter-mismatch-1",
      index: 2,
      type: "udp-counter-mismatch",
      transport: "udp",
      scope: { kind: "session" },
      severity: "critical",
      message: "The bridge reported one more datagram than the browser retained.",
      bridgeDatagrams: replay.records.length + 1,
      bridgeBytes: bytes + 1,
      browserDatagrams: replay.records.length,
      browserBytes: bytes,
      retainedRecords: replay.records.length,
      retainedBytes: bytes,
    },
  ] satisfies TransportEvent[];
  return {
    ...replay,
    transportEvents,
    captureIntegrity: {
      ...replay.captureIntegrity,
      status: "incomplete",
      input: {
        ...replay.captureIntegrity.input,
        transportReportedUnits: replay.records.length + 1,
        transportReportedBytes: bytes + 1,
      },
      issueCodes: [
        "udp-event-sequence-discontinuity",
        "capture-backpressure",
        "udp-counter-mismatch",
      ],
    },
  };
}

function diagnostic(id: string, startUs: number, endUs?: number): DiagnosticEvent {
  return {
    id,
    type: "recovery",
    domain: "link",
    severity: "info",
    startUs,
    endUs,
    title: id,
    description: `${id} diagnostic`,
    frameIds: [],
  };
}

describe("session parsing", () => {
  it("validates, decodes, derives metrics, and projects incidents", () => {
    const parsed = parseSession(document());

    expect(parsed.frames).toHaveLength(5);
    expect(parsed.buckets).toHaveLength(6);
    expect(parsed.buckets[0]).toMatchObject({ latitude: 47.2672, longitude: -122.5514, altitudeM: 184 });
    expect(parsed.buckets[1]).toMatchObject({ latitude: 47.2672, longitude: -122.5514, altitudeM: 184 });
    expect(parsed.buckets[3]?.missing).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
    expect(parsed.incidents[0]?.stats.completePackets).toBe(3);
    expect(parsed.diagnostics.some((event) => event.type === "crc-failure")).toBe(true);
  });

  it("uses half-open ranges", () => {
    const rows = [{ offsetUs: 0 }, { offsetUs: 10 }, { offsetUs: 20 }, { offsetUs: 30 }] as const;
    expect(rowsInRange(rows, 10, 30)).toEqual([{ offsetUs: 10 }, { offsetUs: 20 }]);
  });

  it("normalizes strict version 1 input without rewriting or mutating its raw document", () => {
    const legacy = document();
    const original = structuredClone(legacy);

    const parsed = parseSession(legacy);

    expect(legacy).toEqual(original);
    expect(parsed.document).not.toBe(legacy);
    expect(parsed.document.formatVersion).toBe(1);
    expect("transportEvents" in parsed.document).toBe(false);
    expect(parsed.transportEvents).toEqual([]);
    expect(parsed.captureIntegrity).toEqual({
      schemaVersion: 1,
      status: "unknown",
      assessmentBasis: "legacy-v1",
      stopDisposition: "not-observed",
      stopOffsetUs: null,
      eventLogComplete: false,
      input: {
        unit: "unknown",
        observedUnits: null,
        observedBytes: null,
        transportReportedUnits: null,
        transportReportedBytes: null,
      },
      retained: { records: legacy.records.length, bytes: retainedBytes(legacy) },
      issueCodes: ["legacy-session-unassessed"],
    });
    expect(Object.isFrozen(parsed.document)).toBe(true);
    expect(Object.isFrozen(parsed.document.records)).toBe(true);
    expect(Object.isFrozen(parsed.transportEvents)).toBe(true);
    expect(Object.isFrozen(parsed.captureIntegrity)).toBe(true);

    const v1WithV2Endpoint = structuredClone(legacy);
    v1WithV2Endpoint.records[0]!.transport.remoteEndpoint = {
      address: "192.0.2.44",
      port: 55_555,
      family: "IPv4",
    };
    expect(() => validateSessionDocument(v1WithV2Endpoint)).toThrow(SessionValidationError);
  });

  it("keeps pre-provenance version 2 documents valid and does not synthesize provenance", () => {
    const replay = v2Document();
    const validated = validateSessionDocument(replay);
    const parsed = parseSession(replay);

    expect(validated).toMatchObject({ formatVersion: 2 });
    expect(Object.keys(validated)).toEqual([
      "format",
      "id",
      "title",
      "startedAt",
      "displayTimeZone",
      "durationUs",
      "source",
      "decoder",
      "records",
      "incidents",
      "formatVersion",
      "transportEvents",
      "captureIntegrity",
    ]);
    expect(Object.keys(validated.records[0]!)).toEqual([
      "id",
      "index",
      "sourceId",
      "offsetUs",
      "dataHex",
      "captureBytes",
      "wireBytes",
      "transport",
      "signal",
    ]);
    expect("transportProvenance" in parsed.document).toBe(false);
    expect(parsed.transportProvenance).toBeUndefined();
  });

  it("validates and exposes frozen verified UDP provenance without downgrading unavailable kernel counters", () => {
    const parsed = parseSession(v2DocumentWithVerifiedUdpProvenance());

    expect(parsed.transportProvenance).toMatchObject({
      transport: "udp",
      status: "verified",
      issueCodes: ["udp-kernel-drop-counter-unavailable"],
      journal: {
        state: "clean",
        bind: { requestedPort: 0, port: 9_104 },
        kernelDroppedDatagrams: null,
        kernelDroppedDatagramsSource: "unavailable",
      },
      endpointAttribution: { attributedRecords: 5, unattributedRecords: 0 },
    });
    expect(parsed.captureIntegrity.status).toBe("verified");
    expect(parsed.diagnostics.some((event) => event.id === "transport-provenance-incomplete")).toBe(false);
    expect(Object.isFrozen(parsed.transportProvenance)).toBe(true);
    expect(parsed.transportProvenance?.transport === "udp"
      && Object.isFrozen(parsed.transportProvenance.journal?.entries)).toBe(true);
  });

  it("rejects inconsistent UDP provenance identity, journal ordering, counters, endpoints, and receipt status", () => {
    const wrongSource = v2DocumentWithVerifiedUdpProvenance();
    if (!wrongSource.transportProvenance) throw new Error("Expected provenance");
    wrongSource.transportProvenance.sourceId = "another-source";
    expect(() => validateSessionDocument(wrongSource)).toThrow("does not match the declared session source");

    const wrongStart = v2DocumentWithVerifiedUdpProvenance();
    if (wrongStart.transportProvenance?.transport !== "udp" || !wrongStart.transportProvenance.journal) {
      throw new Error("Expected UDP journal");
    }
    wrongStart.transportProvenance.journal.startedAt = "2026-07-16T04:38:13.000Z";
    expect(() => validateSessionDocument(wrongStart)).toThrow("journal start does not match");

    const badOrder = v2DocumentWithVerifiedUdpProvenance();
    if (badOrder.transportProvenance?.transport !== "udp" || !badOrder.transportProvenance.journal) {
      throw new Error("Expected UDP journal");
    }
    badOrder.transportProvenance.journal.entries = [
      ...badOrder.transportProvenance.journal.entries.slice(0, 1),
      { ...badOrder.transportProvenance.journal.entries[1]!, sequence: 0 },
    ];
    expect(() => validateSessionDocument(badOrder)).toThrow("not monotonic");

    const wallClockCorrection = v2DocumentWithVerifiedUdpProvenance();
    if (
      wallClockCorrection.transportProvenance?.transport !== "udp"
      || !wallClockCorrection.transportProvenance.journal
    ) {
      throw new Error("Expected UDP journal");
    }
    wallClockCorrection.transportProvenance.journal.entries = [
      ...wallClockCorrection.transportProvenance.journal.entries.slice(0, 1),
      { ...wallClockCorrection.transportProvenance.journal.entries[1]!, at: "2026-07-16T04:38:11.000Z" },
    ];
    wallClockCorrection.transportProvenance.journal.endedAt = "2026-07-16T04:38:11.000Z";
    expect(validateSessionDocument(wallClockCorrection)).toMatchObject({
      transportProvenance: { status: "verified" },
    });

    const cleanJournalWithError = v2DocumentWithVerifiedUdpProvenance();
    if (
      cleanJournalWithError.transportProvenance?.transport !== "udp"
      || !cleanJournalWithError.transportProvenance.journal
    ) {
      throw new Error("Expected UDP journal");
    }
    const cleanTerminal = cleanJournalWithError.transportProvenance.journal.entries.at(-1)!;
    cleanJournalWithError.transportProvenance.journal.entries = [
      cleanJournalWithError.transportProvenance.journal.entries[0]!,
      {
        sequence: 1,
        type: "bridge-error",
        at: "2026-07-16T04:38:15.000Z",
        offsetUs: 3_000_000,
        datagrams: 2,
        bytes: cleanTerminal.bytes,
        code: "socket-error",
        message: "The bridge reported an error.",
        fatal: false,
      },
      { ...cleanTerminal, sequence: 2 },
    ];
    expect(() => validateSessionDocument(cleanJournalWithError)).toThrow(
      "error entries require incomplete journal state",
    );

    const shorterBridgeClock = v2DocumentWithVerifiedUdpProvenance();
    if (
      shorterBridgeClock.transportProvenance?.transport !== "udp"
      || !shorterBridgeClock.transportProvenance.journal
    ) {
      throw new Error("Expected UDP journal");
    }
    const bridgeTerminal = shorterBridgeClock.transportProvenance.journal.entries.at(-1)!;
    shorterBridgeClock.transportProvenance.journal.entries = [
      ...shorterBridgeClock.transportProvenance.journal.entries.slice(0, -1),
      { ...bridgeTerminal, offsetUs: shorterBridgeClock.durationUs - 1 },
    ];
    expect(validateSessionDocument(shorterBridgeClock)).toMatchObject({
      transportProvenance: { status: "verified" },
    });

    const oversizedJournal = v2DocumentWithVerifiedUdpProvenance();
    if (oversizedJournal.transportProvenance?.transport !== "udp" || !oversizedJournal.transportProvenance.journal) {
      throw new Error("Expected UDP journal");
    }
    const firstEntry = oversizedJournal.transportProvenance.journal.entries[0]!;
    oversizedJournal.transportProvenance.journal.entries = Array.from({ length: 129 }, (_, index) => ({
      ...firstEntry,
      sequence: index,
    }));
    expect(() => validateSessionDocument(oversizedJournal)).toThrow(SessionValidationError);

    const badSummary = v2DocumentWithVerifiedUdpProvenance();
    if (badSummary.transportProvenance?.transport !== "udp") throw new Error("Expected UDP provenance");
    badSummary.transportProvenance.endpointAttribution.attributedRecords -= 1;
    badSummary.transportProvenance.endpointAttribution.unattributedRecords += 1;
    expect(() => validateSessionDocument(badSummary)).toThrow("summary does not match");

    const undocumentedCounterMismatch = v2DocumentWithVerifiedUdpProvenance();
    if (
      undocumentedCounterMismatch.transportProvenance?.transport !== "udp"
      || !undocumentedCounterMismatch.transportProvenance.journal
    ) throw new Error("Expected UDP journal");
    undocumentedCounterMismatch.transportProvenance.journal.datagrams += 1;
    const terminal = undocumentedCounterMismatch.transportProvenance.journal.entries.at(-1)!;
    undocumentedCounterMismatch.transportProvenance.journal.entries = [
      ...undocumentedCounterMismatch.transportProvenance.journal.entries.slice(0, -1),
      { ...terminal, datagrams: terminal.datagrams + 1 },
    ];
    expect(() => validateSessionDocument(undocumentedCounterMismatch)).toThrow("counters and issue codes");

    const receiptMismatch = v2DocumentWithVerifiedUdpProvenance();
    receiptMismatch.captureIntegrity.status = "incomplete";
    receiptMismatch.captureIntegrity.issueCodes = ["transport-provenance-incomplete"];
    expect(() => validateSessionDocument(receiptMismatch)).toThrow("Capture integrity and transport-provenance status");
  });

  it("accepts explicitly incomplete provenance and projects its mismatch as a capture-path diagnostic", () => {
    const replay = v2DocumentWithVerifiedUdpProvenance();
    if (replay.transportProvenance?.transport !== "udp" || !replay.transportProvenance.journal) {
      throw new Error("Expected UDP journal");
    }
    replay.transportProvenance.status = "incomplete";
    replay.transportProvenance.issueCodes = [
      "udp-bridge-journal-counter-mismatch",
      "udp-kernel-drop-counter-unavailable",
    ];
    replay.transportProvenance.journal.datagrams += 1;
    replay.transportProvenance.journal.bytes += 1;
    const terminal = replay.transportProvenance.journal.entries.at(-1)!;
    replay.transportProvenance.journal.entries = [
      ...replay.transportProvenance.journal.entries.slice(0, -1),
      { ...terminal, datagrams: terminal.datagrams + 1, bytes: terminal.bytes + 1 },
    ];
    replay.captureIntegrity.status = "incomplete";
    replay.captureIntegrity.issueCodes = ["transport-provenance-incomplete"];

    const parsed = parseSession(replay);
    expect(parsed.transportProvenance?.status).toBe("incomplete");
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      id: "transport-provenance-incomplete",
      domain: "capture-path",
      startUs: 0,
      endUs: replay.durationUs,
    }));
  });

  it("requires complete serial settings while accepting explicitly unavailable device identifiers", () => {
    const replay = v2SerialDocument();
    replay.transportProvenance = {
      schemaVersion: 1,
      transport: "serial",
      sourceId: replay.source.id,
      status: "verified",
      issueCodes: ["serial-device-identifiers-unavailable"],
      device: { usbVendorId: null, usbProductId: null, bluetoothServiceClassId: null },
      settings: {
        baudRate: 115_200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        bufferSize: 65_536,
        flowControl: "none",
      },
    };
    expect(validateSessionDocument(replay)).toMatchObject({
      transportProvenance: { status: "verified", issueCodes: ["serial-device-identifiers-unavailable"] },
      captureIntegrity: { status: "verified" },
    });

    const missingSetting = structuredClone(replay) as unknown as Record<string, unknown>;
    const provenance = missingSetting.transportProvenance as { settings: Record<string, unknown> };
    delete provenance.settings.baudRate;
    expect(() => validateSessionDocument(missingSetting)).toThrow(SessionValidationError);

    const falselyIncomplete = structuredClone(replay);
    if (!falselyIncomplete.transportProvenance) throw new Error("Expected serial provenance");
    falselyIncomplete.transportProvenance.status = "incomplete";
    falselyIncomplete.captureIntegrity.status = "incomplete";
    falselyIncomplete.captureIntegrity.issueCodes = ["transport-provenance-incomplete"];
    expect(() => validateSessionDocument(falselyIncomplete)).toThrow("must produce verified transport provenance");
  });

  it("rejects UDP-only kernel counters on version 2 serial and file records", () => {
    const serial = v2SerialDocument();
    (serial.records[0]!.transport as { kind: "serial"; kernelDropCounter?: null }).kernelDropCounter = null;
    expect(() => validateSessionDocument(serial)).toThrow(SessionValidationError);

    const file = v2FileDocument();
    (file.records[0]!.transport as { kind: "file"; kernelDropCounter?: number }).kernelDropCounter = 0;
    expect(() => validateSessionDocument(file)).toThrow(SessionValidationError);
  });

  it("maps durable version 2 transport evidence into capture-path diagnostics with exact range semantics", () => {
    const parsed = parseSession(v2DocumentWithTransportEvents());
    const captureDiagnostics = parsed.diagnostics.filter((event) => event.domain === "capture-path");

    expect(parsed.document.formatVersion).toBe(2);
    expect(parsed.transportEvents).toHaveLength(3);
    expect(captureDiagnostics.map((event) => [event.id, event.startUs, event.endUs])).toEqual([
      ["transport-udp-counter-mismatch-1", 0, parsed.document.durationUs],
      ["transport-udp-sequence-gap-1", 1_000_000, undefined],
      ["transport-capture-backpressure-1", 2_000_000, 3_000_000],
    ]);
    expect(parsed.diagnostics.filter((event) => event.type !== "capture-path-event").every(
      (event) => event.domain === "link" || event.domain === "decoder" || event.domain === "unknown",
    )).toBe(true);
    expect(parsed.diagnostics.filter(
      (event) => event.type === "crc-failure" || event.type === "partial-frame",
    ).every((event) => event.domain === "unknown")).toBe(true);

    const firstRange = projectIncident(
      { id: "first", title: "First", startUs: 1_000_000, endUs: 2_000_000, severity: "critical" },
      parsed.frames,
      parsed.diagnostics,
    );
    expect(firstRange.diagnostics.filter((event) => event.domain === "capture-path").map((event) => event.id)).toEqual([
      "transport-udp-counter-mismatch-1",
      "transport-udp-sequence-gap-1",
    ]);

    const afterInterval = projectIncident(
      { id: "after", title: "After", startUs: 3_000_000, endUs: 4_000_000, severity: "critical" },
      parsed.frames,
      parsed.diagnostics,
    );
    expect(afterInterval.diagnostics.filter((event) => event.domain === "capture-path").map((event) => event.id)).toEqual([
      "transport-udp-counter-mismatch-1",
    ]);
  });

  it("strictly validates versioned transport evidence and receipt reconciliation", () => {
    const version1WithV2Fields = {
      ...document(),
      transportEvents: [],
      captureIntegrity: verifiedUdpReceipt(document()),
    };
    expect(() => validateSessionDocument(version1WithV2Fields)).toThrow(SessionValidationError);

    const missingV2Evidence = { ...v2Document() } as Partial<SessionDocumentV2>;
    delete missingV2Evidence.captureIntegrity;
    expect(() => validateSessionDocument(missingV2Evidence)).toThrow(SessionValidationError);

    const badIndex = structuredClone(v2DocumentWithTransportEvents());
    badIndex.transportEvents[0]!.index = 9;
    expect(() => validateSessionDocument(badIndex)).toThrow("indices must be contiguous");

    const badBoundary = structuredClone(v2DocumentWithTransportEvents());
    const first = badBoundary.transportEvents[0];
    if (!first || first.scope.kind !== "point") throw new Error("Expected point event");
    first.scope.offsetUs = badBoundary.durationUs;
    expect(() => validateSessionDocument(badBoundary)).toThrow("outside the declared session duration");

    const duplicateId = structuredClone(v2DocumentWithTransportEvents());
    duplicateId.transportEvents[1]!.id = duplicateId.transportEvents[0]!.id;
    expect(() => validateSessionDocument(duplicateId)).toThrow("duplicate transport event IDs");

    const badReceipt = structuredClone(v2Document());
    badReceipt.captureIntegrity.retained.bytes += 1;
    expect(() => validateSessionDocument(badReceipt)).toThrow("does not match retained session records");

    const contradictoryVerified = structuredClone(v2DocumentWithTransportEvents());
    contradictoryVerified.captureIntegrity.status = "verified";
    expect(() => validateSessionDocument(contradictoryVerified)).toThrow("verified capture-integrity receipt");
  });

  it("requires UDP mismatch codes while allowing an exhausted event log to omit the event", () => {
    const missingMismatchEvidence = v2Document();
    missingMismatchEvidence.captureIntegrity.status = "incomplete";
    missingMismatchEvidence.captureIntegrity.eventLogComplete = false;
    missingMismatchEvidence.captureIntegrity.issueCodes = ["event-log-incomplete"];
    missingMismatchEvidence.captureIntegrity.input.transportReportedUnits = missingMismatchEvidence.records.length + 1;
    expect(() => validateSessionDocument(missingMismatchEvidence)).toThrow(
      "Unreconciled UDP counters require one matching counter-mismatch issue and event",
    );

    const missingMismatchEvent = structuredClone(missingMismatchEvidence);
    missingMismatchEvent.captureIntegrity.issueCodes.push("udp-counter-mismatch");
    expect(validateSessionDocument(missingMismatchEvent)).toMatchObject(
      { captureIntegrity: { eventLogComplete: false, issueCodes: ["event-log-incomplete", "udp-counter-mismatch"] } },
    );

    const falselyCompleteEventLog = structuredClone(missingMismatchEvent);
    falselyCompleteEventLog.captureIntegrity.eventLogComplete = true;
    falselyCompleteEventLog.captureIntegrity.issueCodes = ["udp-counter-mismatch"];
    expect(() => validateSessionDocument(falselyCompleteEventLog)).toThrow(
      "issue code is not represented by a transport event",
    );

    const duplicateMismatchEvent = v2DocumentWithTransportEvents();
    duplicateMismatchEvent.captureIntegrity.eventLogComplete = false;
    duplicateMismatchEvent.captureIntegrity.issueCodes.push("event-log-incomplete");
    const mismatchEvent = duplicateMismatchEvent.transportEvents[2];
    if (!mismatchEvent || mismatchEvent.type !== "udp-counter-mismatch") throw new Error("Expected UDP mismatch event");
    duplicateMismatchEvent.transportEvents.push({
      ...mismatchEvent,
      id: "udp-counter-mismatch-2",
      index: 3,
    });
    expect(() => validateSessionDocument(duplicateMismatchEvent)).toThrow(
      "Unreconciled UDP counters require one matching counter-mismatch issue and event",
    );

    expect(validateSessionDocument(v2DocumentWithTransportEvents()).formatVersion).toBe(2);
  });

  it("rejects orphan, cross-transport, and legacy-only live issue codes", () => {
    const orphanEventCode = v2Document();
    orphanEventCode.captureIntegrity.status = "incomplete";
    orphanEventCode.captureIntegrity.issueCodes = ["udp-bridge-error"];
    expect(() => validateSessionDocument(orphanEventCode)).toThrow(
      "issue code is not represented by a transport event",
    );

    const crossTransportCode = v2Document();
    crossTransportCode.captureIntegrity.status = "incomplete";
    crossTransportCode.captureIntegrity.eventLogComplete = false;
    crossTransportCode.captureIntegrity.issueCodes = ["serial-disconnected", "event-log-incomplete"];
    expect(() => validateSessionDocument(crossTransportCode)).toThrow(
      "issue code does not apply to the declared live source",
    );

    const legacyOnlyCode = v2Document();
    legacyOnlyCode.captureIntegrity.status = "incomplete";
    legacyOnlyCode.captureIntegrity.eventLogComplete = false;
    legacyOnlyCode.captureIntegrity.issueCodes = ["legacy-session-unassessed", "event-log-incomplete"];
    expect(() => validateSessionDocument(legacyOnlyCode)).toThrow(
      "issue code does not apply to the declared live source",
    );
  });

  it("accepts browser-only UDP and recorder-only evidence without inventing bridge observations", () => {
    const browserObserved = v2Document();
    browserObserved.transportEvents = [{
      id: "shutdown-unconfirmed-1",
      index: 0,
      type: "shutdown-unconfirmed",
      transport: "udp",
      scope: { kind: "session" },
      severity: "critical",
      message: "The UDP bridge did not return a terminal status.",
      code: "bridge-unreachable",
    }];
    browserObserved.captureIntegrity = {
      ...browserObserved.captureIntegrity,
      status: "incomplete",
      assessmentBasis: "udp-browser-observed",
      stopDisposition: "unconfirmed",
      input: {
        ...browserObserved.captureIntegrity.input,
        transportReportedUnits: null,
        transportReportedBytes: null,
      },
      issueCodes: ["shutdown-unconfirmed"],
    };
    expect(validateSessionDocument(browserObserved)).toMatchObject({
      captureIntegrity: {
        status: "incomplete",
        assessmentBasis: "udp-browser-observed",
        input: { transportReportedUnits: null, transportReportedBytes: null },
      },
    });

    const falselyVerified = structuredClone(browserObserved);
    falselyVerified.captureIntegrity.status = "verified";
    expect(() => validateSessionDocument(falselyVerified)).toThrow(
      "browser-observed UDP receipt must honestly describe unavailable terminal bridge counters",
    );

    const recorderOnly = structuredClone(browserObserved);
    recorderOnly.captureIntegrity.assessmentBasis = "recorder-only";
    recorderOnly.captureIntegrity.eventLogComplete = false;
    recorderOnly.captureIntegrity.input.observedUnits = null;
    recorderOnly.captureIntegrity.input.observedBytes = null;
    recorderOnly.captureIntegrity.issueCodes = ["shutdown-unconfirmed", "event-log-incomplete"];
    expect(validateSessionDocument(recorderOnly)).toMatchObject({
      captureIntegrity: {
        status: "incomplete",
        assessmentBasis: "recorder-only",
        eventLogComplete: false,
      },
    });
  });

  it("requires exact serial byte-mismatch evidence without equating reads to records", () => {
    const missingMismatch = v2SerialDocument();
    missingMismatch.captureIntegrity.status = "incomplete";
    missingMismatch.captureIntegrity.eventLogComplete = false;
    missingMismatch.captureIntegrity.input.observedBytes = retainedBytes(missingMismatch) + 1;
    missingMismatch.captureIntegrity.issueCodes = ["event-log-incomplete"];
    expect(() => validateSessionDocument(missingMismatch)).toThrow(
      "Unreconciled serial byte counts require one matching counter-mismatch issue and event",
    );

    const exhaustedMismatchLog = structuredClone(missingMismatch);
    exhaustedMismatchLog.captureIntegrity.issueCodes.push("serial-counter-mismatch");
    expect(validateSessionDocument(exhaustedMismatchLog)).toMatchObject({
      captureIntegrity: {
        eventLogComplete: false,
        issueCodes: ["event-log-incomplete", "serial-counter-mismatch"],
      },
    });

    const falselyCompleteMismatchLog = structuredClone(exhaustedMismatchLog);
    falselyCompleteMismatchLog.captureIntegrity.eventLogComplete = true;
    falselyCompleteMismatchLog.captureIntegrity.issueCodes = ["serial-counter-mismatch"];
    expect(() => validateSessionDocument(falselyCompleteMismatchLog)).toThrow(
      "issue code is not represented by a transport event",
    );

    const serialMismatch = v2SerialDocument();
    const observedBytes = retainedBytes(serialMismatch) + 1;
    serialMismatch.transportEvents = [{
      id: "serial-counter-mismatch-1",
      index: 0,
      type: "serial-counter-mismatch",
      transport: "serial",
      scope: { kind: "session" },
      severity: "critical",
      message: "One observed serial byte was not retained.",
      observedReads: 2,
      observedBytes,
      retainedRecords: serialMismatch.records.length,
      retainedBytes: retainedBytes(serialMismatch),
    }];
    serialMismatch.captureIntegrity = {
      ...serialMismatch.captureIntegrity,
      status: "incomplete",
      input: {
        ...serialMismatch.captureIntegrity.input,
        observedUnits: 2,
        observedBytes,
      },
      issueCodes: ["serial-counter-mismatch"],
    };
    expect(validateSessionDocument(serialMismatch)).toMatchObject({
      captureIntegrity: {
        status: "incomplete",
        issueCodes: ["serial-counter-mismatch"],
      },
    });

    const conflictingEvent = structuredClone(serialMismatch);
    const event = conflictingEvent.transportEvents[0];
    if (!event || event.type !== "serial-counter-mismatch") throw new Error("Expected serial mismatch event");
    event.observedReads += 1;
    expect(() => validateSessionDocument(conflictingEvent)).toThrow(
      "serial counter-mismatch event conflicts with the capture-integrity receipt",
    );
  });

  it("pairs a duration-capped receipt issue with a duration capture-limit event", () => {
    const durationCapped = v2Document();
    durationCapped.transportEvents = [{
      id: "capture-duration-limit-1",
      index: 0,
      type: "capture-limit",
      transport: "udp",
      scope: { kind: "point", offsetUs: durationCapped.durationUs - 1 },
      severity: "critical",
      message: "The capture reached its configured duration limit.",
      component: "recorder",
      limit: "duration",
      limitValue: durationCapped.durationUs,
      observedValue: durationCapped.durationUs + 1,
    }];
    durationCapped.captureIntegrity.status = "incomplete";
    durationCapped.captureIntegrity.issueCodes = ["capture-limit", "duration-capped"];
    expect(validateSessionDocument(durationCapped).formatVersion).toBe(2);

    const missingDerivedCode = structuredClone(durationCapped);
    missingDerivedCode.captureIntegrity.issueCodes = ["capture-limit"];
    expect(() => validateSessionDocument(missingDerivedCode)).toThrow(
      "duration-capped receipt issue and capture-limit event are inconsistent",
    );

    const missingLimitEvent = v2Document();
    missingLimitEvent.captureIntegrity.status = "incomplete";
    missingLimitEvent.captureIntegrity.issueCodes = ["duration-capped"];
    expect(() => validateSessionDocument(missingLimitEvent)).toThrow(
      "duration-capped receipt issue and capture-limit event are inconsistent",
    );

    const exhaustedDurationLog = structuredClone(missingLimitEvent);
    exhaustedDurationLog.captureIntegrity.eventLogComplete = false;
    exhaustedDurationLog.captureIntegrity.issueCodes.push("event-log-incomplete");
    expect(validateSessionDocument(exhaustedDurationLog)).toMatchObject({
      captureIntegrity: {
        eventLogComplete: false,
        issueCodes: ["duration-capped", "event-log-incomplete"],
      },
    });

    const duplicateDurationEvent = structuredClone(durationCapped);
    duplicateDurationEvent.captureIntegrity.eventLogComplete = false;
    duplicateDurationEvent.captureIntegrity.issueCodes.push("event-log-incomplete");
    const durationEvent = duplicateDurationEvent.transportEvents[0];
    if (!durationEvent || durationEvent.type !== "capture-limit") throw new Error("Expected duration limit event");
    duplicateDurationEvent.transportEvents.push({
      ...durationEvent,
      id: "capture-duration-limit-2",
      index: 1,
    });
    expect(() => validateSessionDocument(duplicateDurationEvent)).toThrow(
      "duration-capped receipt issue and capture-limit event are inconsistent",
    );
  });

  it("accepts an honestly unassessed version 2 file source without inventing an event log", () => {
    const replay = v2Document();
    replay.source = { id: "harbor-udp", kind: "file", label: "Imported telemetry file" };
    for (const sourceRecord of replay.records) sourceRecord.transport.kind = "file";
    replay.captureIntegrity = {
      schemaVersion: 1,
      status: "unknown",
      assessmentBasis: "file-source-unassessed",
      stopDisposition: "not-observed",
      stopOffsetUs: null,
      eventLogComplete: false,
      input: {
        unit: "unknown",
        observedUnits: null,
        observedBytes: null,
        transportReportedUnits: null,
        transportReportedBytes: null,
      },
      retained: { records: replay.records.length, bytes: retainedBytes(replay) },
      issueCodes: ["file-source-unassessed"],
    };

    const parsed = parseSession(replay);

    expect(parsed.captureIntegrity).toMatchObject({
      status: "unknown",
      assessmentBasis: "file-source-unassessed",
      eventLogComplete: false,
    });
    expect(parsed.transportEvents).toEqual([]);

    const pollutedFileReceipt = structuredClone(replay);
    pollutedFileReceipt.captureIntegrity.issueCodes.push("legacy-session-unassessed");
    expect(() => validateSessionDocument(pollutedFileReceipt)).toThrow(
      "file-source session must declare unassessed capture integrity",
    );
  });

  it("strictly validates operator-authored incident presets against the session duration", () => {
    const preset = {
      id: "operator-range",
      title: "Operator range",
      startUs: 1_000_000,
      endUs: 6_000_000,
      severity: "warning",
    } satisfies IncidentPreset;

    const validated = validateIncidentPreset(preset, 6_000_000);
    expect(validated).toEqual(preset);
    expect(validated).not.toBe(preset);

    const invalidInputs: unknown[] = [
      { ...preset, startUs: -1 },
      { ...preset, startUs: 0.5 },
      { ...preset, startUs: 2_000_000, endUs: 2_000_000 },
      { ...preset, startUs: 3_000_000, endUs: 2_000_000 },
      { ...preset, unexpected: true },
    ];
    for (const invalid of invalidInputs) {
      expect(() => validateIncidentPreset(invalid, 6_000_000)).toThrow("incident range is invalid");
    }

    expect(() => validateIncidentPreset({ ...preset, endUs: 6_000_001 }, 6_000_000)).toThrow(
      "outside the declared session duration",
    );
    expect(() => validateIncidentPreset(preset, 0)).toThrow("invalid session duration");
  });

  it("projects and resizes an authored range without mutating parsed evidence or the document", () => {
    const parsed = parseSession(document());
    const originalDocument = structuredClone(parsed.document);
    const originalFrames = structuredClone(parsed.frames);
    const originalDiagnostics = structuredClone(parsed.diagnostics);
    const authored = Object.freeze({
      id: "operator-range",
      title: "Operator range",
      startUs: 1_000_000,
      endUs: 3_000_000,
      severity: "warning" as const,
    });
    const readonlyFrames = Object.freeze(parsed.frames);
    const readonlyDiagnostics = Object.freeze(parsed.diagnostics);

    const narrow = projectIncident(authored, readonlyFrames, readonlyDiagnostics);
    const resized = projectIncident({ ...authored, endUs: 4_000_000 }, readonlyFrames, readonlyDiagnostics);

    expect(narrow).toMatchObject({
      id: "operator-range",
      startUs: 1_000_000,
      endUs: 3_000_000,
      stats: { receivedFrames: 2 },
    });
    expect(resized.stats.receivedFrames).toBe(3);
    expect(narrow.stats.receivedFrames).toBe(2);
    expect(parsed.document).toEqual(originalDocument);
    expect(parsed.frames).toEqual(originalFrames);
    expect(parsed.diagnostics).toEqual(originalDiagnostics);
    expect(authored.endUs).toBe(3_000_000);
  });

  it("uses half-open overlap semantics for point and interval diagnostics", () => {
    const parsed = parseSession(document());
    const diagnostics = Object.freeze([
      diagnostic("ends-at-start", 500_000, 1_000_000),
      diagnostic("crosses-start", 500_000, 1_500_000),
      diagnostic("point-at-start", 1_000_000),
      diagnostic("point-inside", 2_000_000),
      diagnostic("point-at-end", 3_000_000),
      diagnostic("starts-at-end", 3_000_000, 4_000_000),
    ]);

    const projection = projectIncident(
      { id: "overlap", title: "Overlap", startUs: 1_000_000, endUs: 3_000_000, severity: "info" },
      parsed.frames,
      diagnostics,
    );

    expect(projection.diagnostics.map((event) => event.id)).toEqual([
      "crosses-start",
      "point-at-start",
      "point-inside",
    ]);
  });

  it("returns explicit unavailable statistics for an authored range with no evidence", () => {
    const parsed = parseSession(document());

    const projection = projectIncident(
      { id: "empty", title: "Empty range", startUs: 5_000_000, endUs: 6_000_000, severity: "info" },
      parsed.frames,
      parsed.diagnostics,
    );

    expect(projection.stats).toEqual({
      receivedFrames: 0,
      expectedFrames: 0,
      missingFrames: 0,
      completePackets: 0,
      lossPct: null,
      decodeConfidencePct: null,
      lowestRssiDbm: null,
      peakJitterMs: null,
      averageThroughput: 0,
      linkAvailabilityPct: null,
    });
  });

  it("rejects non-monotonic timestamps with an actionable error", () => {
    const invalid = document();
    invalid.records = [record(0, 2_000_000, 1, 0x02), record(1, 1_000_000, 2, 0x02)];

    expect(() => validateSessionDocument(invalid)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(invalid);
    } catch (error) {
      expect((error as SessionValidationError).message).toContain("not monotonic");
    }
  });

  it("rejects inconsistent record provenance before decoding", () => {
    const badIndex = document();
    const indexedRecord = badIndex.records[1];
    if (!indexedRecord) throw new Error("Expected fixture record");
    indexedRecord.index = 9;
    expect(() => validateSessionDocument(badIndex)).toThrow("indices must be contiguous");

    const badWireLength = document();
    const wireRecord = badWireLength.records[0];
    if (!wireRecord) throw new Error("Expected fixture record");
    wireRecord.wireBytes = wireRecord.captureBytes - 1;
    expect(() => validateSessionDocument(badWireLength)).toThrow("fewer wire bytes");

    const badTransport = document();
    const transportRecord = badTransport.records[0];
    if (!transportRecord) throw new Error("Expected fixture record");
    transportRecord.transport.kind = "serial";
    expect(() => validateSessionDocument(badTransport)).toThrow("transport does not match");
  });

  it("rejects replay metadata that names an unsupported decoder descriptor", () => {
    const unsupported = document();
    unsupported.decoder = { ...SUPPORTED_DECODER, revision: "v1.3.6" };

    expect(() => validateSessionDocument(unsupported)).toThrow("unsupported decoder schema");
    try {
      validateSessionDocument(unsupported);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionValidationError);
      expect((error as SessionValidationError).details).toEqual(expect.arrayContaining([
        expect.stringContaining("Received NSL-01 v1.3.6"),
        expect.stringContaining(`Supported ${SUPPORTED_DECODER.id} ${SUPPORTED_DECODER.revision}`),
        expect.stringContaining("Supported NMEA-0183 reference-v1"),
      ]));
    }
  });

  it("decodes an embedded NMEA pack through the shared session pipeline", () => {
    const replay = v2FileDocument();
    const fixture = NMEA0183_DECODER_PACK.fixtures[0];
    if (!fixture) throw new Error("Expected NMEA fixture");
    replay.id = "nmea-session";
    replay.title = "NMEA UDP capture";
    replay.decoder = decoderDescriptorForPack(NMEA0183_DECODER_PACK);
    replay.decoderPack = NMEA0183_DECODER_PACK;
    replay.durationUs = fixture.records[0]!.offsetUs + 1;
    replay.incidents = [];
    replay.records = fixture.records.map((source, index) => ({
      id: `nmea-record-${index + 1}`,
      index,
      sourceId: replay.source.id,
      offsetUs: source.offsetUs,
      dataHex: source.dataHex,
      captureBytes: source.dataHex.length / 2,
      wireBytes: source.dataHex.length / 2,
      transport: { kind: "file" },
    }));
    replay.captureIntegrity.retained = {
      records: replay.records.length,
      bytes: replay.records.reduce((total, source) => total + source.captureBytes, 0),
    };

    const parsed = parseSession(replay);

    expect(parsed.decoderPack.integrity.canonicalSha256).toBe(NMEA0183_DECODER_PACK.integrity.canonicalSha256);
    expect(parsed.frames[0]).toMatchObject({
      status: "complete",
      familyName: "NMEA GGA · Global Positioning System Fix Data",
      integrity: { status: "valid" },
    });
    expect(parsed.frames[0]?.fields.find((field) => field.name === "latitude")?.value).toBeCloseTo(48.1173);
  });

  it("rejects an altered embedded pack without mutating raw records", () => {
    const replay = v2FileDocument();
    const fixture = NMEA0183_DECODER_PACK.fixtures[0];
    if (!fixture) throw new Error("Expected NMEA fixture");
    replay.decoder = decoderDescriptorForPack(NMEA0183_DECODER_PACK);
    replay.decoderPack = JSON.parse(JSON.stringify(NMEA0183_DECODER_PACK)) as typeof NMEA0183_DECODER_PACK;
    replay.decoderPack.description = "Altered pack";
    const rawBefore = JSON.stringify(replay.records);

    expect(() => validateSessionDocument(replay)).toThrow("unsupported decoder schema");
    expect(JSON.stringify(replay.records)).toBe(rawBefore);
  });

  it("projects the entire replay as a review range when no incidents are declared", () => {
    const replay = document();
    replay.incidents = [];

    const parsed = parseSession(replay);

    expect(parsed.incidents).toHaveLength(1);
    expect(parsed.incidents[0]).toMatchObject({
      id: "full-session",
      title: "Full session review",
      startUs: 0,
      endUs: replay.durationUs,
      severity: "info",
    });
    expect(parsed.incidents[0]?.stats.receivedFrames).toBe(replay.records.length);
  });

  it("reports unavailable link availability when the selected range has no signal samples", () => {
    const replay = document();
    for (const sourceRecord of replay.records) delete sourceRecord.signal;

    const parsed = parseSession(replay);

    expect(parsed.incidents[0]?.stats.linkAvailabilityPct).toBeNull();
    expect(parsed.buckets.every((bucket) => bucket.rssiDbm == null)).toBe(true);
  });

  it("uses sequence gaps when the kernel drop counter remains constant", () => {
    const replay = document();
    replay.records = [record(0, 0, 10, 0x02), record(1, 1_000_000, 13, 0x02)];
    for (const sourceRecord of replay.records) sourceRecord.transport.kernelDropCounter = 7;
    replay.incidents = [{ id: "loss", title: "Loss", startUs: 0, endUs: 2_000_000, severity: "warning" }];

    const parsed = parseSession(replay);

    expect(parsed.buckets[1]?.missing).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
    expect(parsed.incidents[0]?.stats.expectedFrames).toBe(4);
  });

  it("does not double-count a loss reported by both sequence and transport counters", () => {
    const replay = document();
    replay.records = [record(0, 0, 10, 0x02), record(1, 1_000_000, 13, 0x02)];
    const firstRecord = replay.records[0];
    const secondRecord = replay.records[1];
    if (!firstRecord || !secondRecord) throw new Error("Expected loss fixture records");
    firstRecord.transport.kernelDropCounter = 4;
    secondRecord.transport.kernelDropCounter = 6;
    replay.incidents = [{ id: "loss", title: "Loss", startUs: 0, endUs: 2_000_000, severity: "warning" }];

    const parsed = parseSession(replay);

    expect(parsed.buckets[1]?.missing).toBe(2);
    expect(parsed.buckets.reduce((total, bucket) => total + bucket.missing, 0)).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
  });

  it("attributes a sequence gap at the selected range boundary consistently", () => {
    const replay = document();
    replay.records = [record(0, 900_000, 10, 0x02), record(1, 1_100_000, 12, 0x02)];
    replay.incidents = [];

    const parsed = parseSession(replay);
    const projection = projectIncident(
      { id: "boundary-loss", title: "Boundary loss", startUs: 1_000_000, endUs: 2_000_000, severity: "warning" },
      parsed.frames,
      parsed.diagnostics,
    );

    expect(parsed.buckets[1]?.missing).toBe(1);
    expect(projection.stats.missingFrames).toBe(1);
    expect(parsed.document.incidents).toEqual([]);
  });

  it("requires 40 uninterrupted seconds of valid frames before declaring decoder relock", () => {
    const replay = document();
    replay.durationUs = 90_000_000;
    replay.records = [
      record(0, 0, 100, 0x02),
      record(1, 1_000_000, 101, 0x02, true),
      record(2, 2_000_000, 102, 0x02, true),
      record(3, 3_000_000, 103, 0x02),
      record(4, 10_000_000, 104, 0x02),
      record(5, 42_000_000, 105, 0x02),
      record(6, 43_000_000, 106, 0x02, true),
      record(7, 44_000_000, 107, 0x02),
      record(8, 45_000_000, 108, 0x02),
      record(9, 83_000_000, 109, 0x02),
      record(10, 84_000_000, 110, 0x02),
    ];
    replay.incidents = [{ id: "resync", title: "Resync", startUs: 0, endUs: replay.durationUs, severity: "warning" }];

    const parsed = parseSession(replay);
    const transitions = parsed.diagnostics.filter(
      (event) => event.type === "decoder-resync" || event.type === "decoder-locked",
    );

    expect(transitions.map((event) => [event.type, event.startUs])).toEqual([
      ["decoder-resync", 2_000_000],
      ["decoder-locked", 84_000_000],
    ]);
    expect(transitions[1]?.description).toContain("40 uninterrupted seconds");
  });

  it("retains a uniquely identified diagnostic for every malformed frame", () => {
    const replay = document();
    replay.records = Array.from({ length: 14 }, (_, index) => record(index, 2_000_000, 100 + index, 0x02, true));
    replay.incidents = [{ id: "malformed", title: "Malformed frames", startUs: 1_000_000, endUs: 3_000_000, severity: "critical" }];

    const parsed = parseSession(replay);
    const failures = parsed.diagnostics.filter((event) => event.type === "crc-failure");

    expect(failures).toHaveLength(14);
    expect(new Set(failures.map((event) => event.id)).size).toBe(14);
    expect(parsed.incidents[0]?.diagnostics.filter((event) => event.type === "crc-failure")).toHaveLength(14);
  });

  it("rejects unpaired UTF-16 surrogates before evidence encoding", () => {
    const replay = document();
    replay.records[0]!.id = "record-\ud800";

    expect(() => validateSessionDocument(replay)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(replay);
    } catch (error) {
      expect((error as SessionValidationError).details.join("\n")).toContain("unpaired UTF-16 surrogate");
    }
  });

  it("rejects unknown document keys instead of silently stripping them", () => {
    const replay = document() as SessionDocument & { unexpectedMetadata?: string };
    replay.unexpectedMetadata = "must not survive validation";

    expect(() => validateSessionDocument(replay)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(replay);
    } catch (error) {
      expect((error as SessionValidationError).details.join("\n")).toContain("unexpectedMetadata");
    }
  });

  it("bounds session duration to protect browser metric allocation", () => {
    const tooLong = document();
    tooLong.durationUs = MAX_SESSION_DURATION_US + 1;
    expect(() => validateSessionDocument(tooLong)).toThrow(SessionValidationError);
  });
});
