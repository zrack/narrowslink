import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

import { strFromU8, unzipSync } from "fflate";

export interface EvidenceArtifact {
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  recordCount?: number;
}

export interface EvidenceUdpEndpoint {
  address: string;
  port: number;
  family: "IPv4" | "IPv6";
}

export interface EvidenceUdpJournalEntry {
  sequence: number;
  type: string;
  offsetUs: number;
  datagrams: number;
  bytes: number;
}

export interface EvidenceUdpJournal {
  captureId: string;
  state: "active" | "clean" | "incomplete";
  datagrams: number;
  bytes: number;
  kernelDroppedDatagrams: number | null;
  kernelDroppedDatagramsSource: "operating-system" | "unavailable";
  entriesComplete: boolean;
  omittedEntries: number;
  entries: EvidenceUdpJournalEntry[];
}

export type EvidenceTransportProvenance =
  | {
      schemaVersion: 1;
      sourceId: string;
      status: "verified" | "incomplete";
      issueCodes: string[];
      transport: "udp";
      journal: EvidenceUdpJournal | null;
      endpointAttribution: {
        totalRecords: number;
        attributedRecords: number;
        unattributedRecords: number;
        distinctEndpoints: EvidenceUdpEndpoint[];
      };
    }
  | {
      schemaVersion: 1;
      sourceId: string;
      status: "verified" | "incomplete";
      issueCodes: string[];
      transport: "serial";
      device: Record<string, unknown>;
      settings: Record<string, unknown>;
    };

export type EvidenceTransportProvenanceDocument =
  | {
      format: "narrowslink/transport-provenance";
      formatVersion: 1;
      availability: "available";
      sessionFormatVersion: 2;
      sourceId: string;
      transport: "udp" | "serial";
      provenance: EvidenceTransportProvenance;
    }
  | {
      format: "narrowslink/transport-provenance";
      formatVersion: 1;
      availability: "unavailable";
      reason: "legacy-v1" | "pre-provenance-v2";
      sessionFormatVersion: 1 | 2;
      sourceId: string;
      transport: "udp" | "serial" | "file";
      provenance: null;
    };

export type EvidenceTransportJournalDocument =
  | {
      format: "narrowslink/transport-journal";
      formatVersion: 1;
      availability: "available";
      sessionFormatVersion: 2;
      sourceId: string;
      transport: "udp";
      captureId: string;
      journal: EvidenceUdpJournal;
    }
  | {
      format: "narrowslink/transport-journal";
      formatVersion: 1;
      availability: "unavailable";
      reason: "legacy-v1" | "pre-provenance-v2" | "journal-unavailable" | "not-applicable";
      sessionFormatVersion: 1 | 2;
      sourceId: string;
      transport: "udp" | "serial" | "file";
      captureId: null;
      journal: null;
    };

export interface EvidenceCaptureIntegrityReceipt {
  input: {
    transportReportedUnits: number | null;
    transportReportedBytes: number | null;
  };
  retained: {
    records: number;
    bytes: number;
  };
}

export interface EvidenceBundleProvenanceSummary {
  availability: "available" | "unavailable";
  status: "verified" | "incomplete" | "unknown";
  sourceId: string;
  transport: "udp" | "serial" | "file";
  issueCodes: string[];
  captureId: string | null;
  endpointAttribution: {
    totalRecords: number;
    attributedRecords: number;
    unattributedRecords: number;
    distinctEndpointCount: number;
  } | null;
  journal: {
    availability: "available" | "unavailable";
    reason: "legacy-v1" | "pre-provenance-v2" | "journal-unavailable" | "not-applicable" | null;
    state: "active" | "clean" | "incomplete" | null;
    entriesComplete: boolean | null;
    entryCount: number;
    omittedEntries: number;
  };
}

export interface EvidenceBundleManifest {
  format: string;
  formatVersion: number;
  generatedAt: string;
  session: {
    id: string;
    title: string;
    formatVersion: 1 | 2;
    sourceId: string;
    captureIntegrity: EvidenceCaptureIntegrityReceipt;
  };
  provenance: EvidenceBundleProvenanceSummary;
  selection: {
    id: string | null;
    title: string | null;
    severity: string | null;
    startUs: number;
    endUs: number;
    rangeSemantics: string;
  };
  inclusions: Record<string, boolean>;
  artifacts: EvidenceArtifact[];
  checksums: {
    algorithm: string;
    path: string;
    covers: string[];
  };
}

export interface RawEvidenceRecord {
  id: string;
  offsetUs: number;
  dataHex: string;
  captureBytes: number;
  transport?: {
    kind?: string;
    remoteEndpoint?: EvidenceUdpEndpoint;
  };
}

export interface VerifiedEvidenceBundle {
  paths: string[];
  manifest: EvidenceBundleManifest;
  rawRecords: RawEvidenceRecord[];
  decodedRecordCount: number;
  diagnostics: unknown[];
  markers: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  transportEvents: Array<Record<string, unknown>>;
  integrityReceipt: unknown;
  transportProvenance: EvidenceTransportProvenanceDocument;
  transportJournal: EvidenceTransportJournalDocument;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeEntry(entries: Record<string, Uint8Array>, path: string): string {
  const bytes = entries[path];
  assert(bytes, `Archive is missing ${path}.`);
  return strFromU8(bytes);
}

function parseJsonEntry<T>(entries: Record<string, Uint8Array>, path: string): T {
  return JSON.parse(decodeEntry(entries, path)) as T;
}

function parseNdjson<T>(text: string): T[] {
  const normalized = text.trim();
  return normalized ? normalized.split("\n").map((line) => JSON.parse(line) as T) : [];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function udpEndpointKey(endpoint: EvidenceUdpEndpoint): string {
  return `${endpoint.family}\u0000${endpoint.address}\u0000${endpoint.port}`;
}

function verifyUdpJournal(journal: EvidenceUdpJournal): void {
  assert(
    (journal.kernelDroppedDatagramsSource === "unavailable") === (journal.kernelDroppedDatagrams === null),
    "Journal kernel-drop availability conflicts with its counter.",
  );
  assert.equal(journal.entriesComplete, journal.omittedEntries === 0, "Journal completeness conflicts with omitted entries.");
  let previousSequence = -1;
  let previousOffsetUs = -1;
  let previousDatagrams = -1;
  let previousBytes = -1;
  for (const [index, entry] of journal.entries.entries()) {
    assert(entry.sequence > previousSequence, "Journal entry sequences must increase.");
    if (journal.entriesComplete) assert.equal(entry.sequence, index, "A complete journal must have contiguous sequences.");
    assert(entry.offsetUs >= previousOffsetUs, "Journal offsets must be monotonic.");
    assert(entry.datagrams >= previousDatagrams, "Journal datagram counters must be monotonic.");
    assert(entry.bytes >= previousBytes, "Journal byte counters must be monotonic.");
    assert(entry.datagrams <= journal.datagrams, "Journal entry datagrams exceed the terminal counter.");
    assert(entry.bytes <= journal.bytes, "Journal entry bytes exceed the terminal counter.");
    previousSequence = entry.sequence;
    previousOffsetUs = entry.offsetUs;
    previousDatagrams = entry.datagrams;
    previousBytes = entry.bytes;
  }
  const last = journal.entries.at(-1);
  if (last?.type === "capture-stopped") {
    assert.equal(last.datagrams, journal.datagrams, "Terminal journal datagrams do not match the journal summary.");
    assert.equal(last.bytes, journal.bytes, "Terminal journal bytes do not match the journal summary.");
  }
}

function verifyTransportEvidence(
  manifest: EvidenceBundleManifest,
  provenanceDocument: EvidenceTransportProvenanceDocument,
  journalDocument: EvidenceTransportJournalDocument,
  integrityReceipt: EvidenceCaptureIntegrityReceipt,
  rawRecords: readonly RawEvidenceRecord[],
): void {
  assert.equal(provenanceDocument.format, "narrowslink/transport-provenance");
  assert.equal(provenanceDocument.formatVersion, 1);
  assert.equal(journalDocument.format, "narrowslink/transport-journal");
  assert.equal(journalDocument.formatVersion, 1);
  assert.equal(provenanceDocument.sessionFormatVersion, manifest.session.formatVersion);
  assert.equal(journalDocument.sessionFormatVersion, manifest.session.formatVersion);
  assert.equal(provenanceDocument.sourceId, manifest.session.sourceId);
  assert.equal(journalDocument.sourceId, manifest.session.sourceId);
  assert.equal(provenanceDocument.transport, manifest.provenance.transport);
  assert.equal(journalDocument.transport, manifest.provenance.transport);

  if (provenanceDocument.availability === "unavailable") {
    const expectedReason = manifest.session.formatVersion === 1 ? "legacy-v1" : "pre-provenance-v2";
    assert.equal(provenanceDocument.reason, expectedReason);
    assert.equal(provenanceDocument.provenance, null);
    assert.equal(journalDocument.availability, "unavailable");
    if (journalDocument.availability === "unavailable") {
      assert.equal(journalDocument.reason, expectedReason);
      assert.equal(journalDocument.captureId, null);
      assert.equal(journalDocument.journal, null);
    }
    assert.deepEqual(manifest.provenance, {
      availability: "unavailable",
      status: "unknown",
      sourceId: manifest.session.sourceId,
      transport: provenanceDocument.transport,
      issueCodes: [],
      captureId: null,
      endpointAttribution: null,
      journal: {
        availability: "unavailable",
        reason: expectedReason,
        state: null,
        entriesComplete: null,
        entryCount: 0,
        omittedEntries: 0,
      },
    });
    return;
  }

  assert.equal(manifest.session.formatVersion, 2, "Available provenance requires a version 2 session.");
  const provenance = provenanceDocument.provenance;
  assert.equal(provenance.sourceId, manifest.session.sourceId);
  assert.equal(provenance.transport, provenanceDocument.transport);
  assert.equal(manifest.provenance.availability, "available");
  assert.equal(manifest.provenance.status, provenance.status);
  assert.deepEqual(manifest.provenance.issueCodes, provenance.issueCodes);
  assert.equal(manifest.provenance.sourceId, provenance.sourceId);

  if (provenance.transport === "serial") {
    assert.equal(manifest.provenance.captureId, null);
    assert.equal(manifest.provenance.endpointAttribution, null);
    assert.equal(journalDocument.availability, "unavailable");
    if (journalDocument.availability === "unavailable") {
      assert.equal(journalDocument.reason, "not-applicable");
      assert.equal(journalDocument.journal, null);
    }
    assert.deepEqual(manifest.provenance.journal, {
      availability: "unavailable",
      reason: "not-applicable",
      state: null,
      entriesComplete: null,
      entryCount: 0,
      omittedEntries: 0,
    });
    return;
  }

  const attribution = provenance.endpointAttribution;
  assert.equal(attribution.attributedRecords + attribution.unattributedRecords, attribution.totalRecords);
  assert.equal(attribution.totalRecords, integrityReceipt.retained.records);
  const distinctEndpointKeys = attribution.distinctEndpoints.map(udpEndpointKey);
  assert.equal(new Set(distinctEndpointKeys).size, distinctEndpointKeys.length, "Distinct UDP endpoints contain duplicates.");
  assert.deepEqual(manifest.provenance.endpointAttribution, {
    totalRecords: attribution.totalRecords,
    attributedRecords: attribution.attributedRecords,
    unattributedRecords: attribution.unattributedRecords,
    distinctEndpointCount: attribution.distinctEndpoints.length,
  });
  const knownEndpoints = new Set(distinctEndpointKeys);
  for (const record of rawRecords) {
    if (record.transport?.kind !== "udp") continue;
    const endpoint = record.transport.remoteEndpoint;
    if (endpoint) {
      assert(knownEndpoints.has(udpEndpointKey(endpoint)), `Raw record ${record.id} has an undeclared UDP endpoint.`);
    } else if (attribution.unattributedRecords === 0) {
      assert.fail(`Raw record ${record.id} lacks endpoint attribution despite a complete provenance summary.`);
    }
  }

  const journal = provenance.journal;
  if (!journal) {
    assert.equal(journalDocument.availability, "unavailable");
    if (journalDocument.availability === "unavailable") assert.equal(journalDocument.reason, "journal-unavailable");
    assert.equal(manifest.provenance.captureId, null);
    assert.deepEqual(manifest.provenance.journal, {
      availability: "unavailable",
      reason: "journal-unavailable",
      state: null,
      entriesComplete: null,
      entryCount: 0,
      omittedEntries: 0,
    });
    return;
  }

  assert.equal(journalDocument.availability, "available");
  if (journalDocument.availability !== "available") return;
  assert.equal(journalDocument.captureId, journal.captureId);
  assert.equal(manifest.provenance.captureId, journal.captureId);
  assert.deepEqual(journalDocument.journal, journal, "Journal artifact does not match provenance capture evidence.");
  verifyUdpJournal(journal);
  assert.notEqual(integrityReceipt.input.transportReportedUnits, null, "A bridge journal requires transport datagram counters.");
  assert.notEqual(integrityReceipt.input.transportReportedBytes, null, "A bridge journal requires transport byte counters.");
  assert.equal(journal.datagrams, integrityReceipt.input.transportReportedUnits, "Journal datagrams do not match the receipt.");
  assert.equal(journal.bytes, integrityReceipt.input.transportReportedBytes, "Journal bytes do not match the receipt.");
  const counterMismatch = journal.datagrams !== integrityReceipt.retained.records || journal.bytes !== integrityReceipt.retained.bytes;
  assert.equal(
    provenance.issueCodes.includes("udp-bridge-journal-counter-mismatch"),
    counterMismatch,
    "Journal counter mismatch status is not represented in provenance issue codes.",
  );
  assert.deepEqual(manifest.provenance.journal, {
    availability: "available",
    reason: null,
    state: journal.state,
    entriesComplete: journal.entriesComplete,
    entryCount: journal.entries.length,
    omittedEntries: journal.omittedEntries,
  });
}

/**
 * Independently validates the archive container, manifest byte counts, and all
 * SHA-256 declarations before returning its operator-visible evidence.
 */
export async function verifyEvidenceBundle(bundlePath: string): Promise<VerifiedEvidenceBundle> {
  const archiveBytes = new Uint8Array(await readFile(bundlePath));
  assert(archiveBytes.byteLength > 0, "Evidence bundle download is empty.");
  const entries = unzipSync(archiveBytes);
  const paths = Object.keys(entries).sort((left, right) => left.localeCompare(right));
  const manifest = parseJsonEntry<EvidenceBundleManifest>(entries, "manifest.json");

  assert.equal(manifest.format, "narrowslink/evidence-bundle");
  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.checksums.algorithm, "SHA-256");
  assert.equal(manifest.checksums.path, "SHA256SUMS");
  assert(Array.isArray(manifest.artifacts));
  const artifactPaths = manifest.artifacts.map((artifact) => artifact.path);
  assert.deepEqual(artifactPaths, sortedUnique(artifactPaths), "Manifest artifact paths must be unique and sorted.");
  for (const requiredPath of [
    "transport/events.json",
    "transport/integrity-receipt.json",
    "transport/journal.json",
    "transport/provenance.json",
  ]) {
    assert(artifactPaths.includes(requiredPath), `Manifest is missing mandatory artifact ${requiredPath}.`);
  }
  const expectedCoveredPaths = sortedUnique(["manifest.json", ...artifactPaths]);
  assert.deepEqual(manifest.checksums.covers, expectedCoveredPaths, "Manifest checksum coverage is incomplete.");
  assert.deepEqual(paths, sortedUnique(["SHA256SUMS", ...expectedCoveredPaths]), "Archive contains unlisted or missing paths.");

  const checksumText = decodeEntry(entries, "SHA256SUMS");
  assert(checksumText.endsWith("\n"), "SHA256SUMS must end with a newline.");
  const checksumLines = checksumText.trimEnd().split("\n");
  assert.equal(checksumLines.length, expectedCoveredPaths.length);
  const checksumByPath = new Map<string, string>();
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    assert(match, `Invalid SHA256SUMS line: ${line}`);
    const [, hash, path] = match;
    assert(hash && path);
    assert(!checksumByPath.has(path), `Duplicate SHA256SUMS path: ${path}`);
    checksumByPath.set(path, hash);
  }
  assert.deepEqual(sortedUnique([...checksumByPath.keys()]), expectedCoveredPaths);

  for (const path of expectedCoveredPaths) {
    const bytes = entries[path];
    assert(bytes, `Checksum path ${path} is absent from the archive.`);
    assert.equal(checksumByPath.get(path), sha256(bytes), `SHA256SUMS mismatch for ${path}.`);
  }
  for (const artifact of manifest.artifacts) {
    const bytes = entries[artifact.path];
    assert(bytes, `Manifest artifact ${artifact.path} is absent from the archive.`);
    assert.equal(artifact.bytes, bytes.byteLength, `Manifest byte count mismatch for ${artifact.path}.`);
    assert.equal(artifact.sha256, sha256(bytes), `Manifest SHA-256 mismatch for ${artifact.path}.`);
  }

  const rawRecords = parseNdjson<RawEvidenceRecord>(decodeEntry(entries, "raw/source-records.ndjson"));
  const decodedText = decodeEntry(entries, "decoded/packets.csv").trimEnd();
  const decodedRecordCount = Math.max(0, decodedText.split(/\r?\n/).length - 1);
  const diagnostics = parseJsonEntry<{ diagnostics: unknown[] }>(entries, "diagnostics/diagnostics.json").diagnostics;
  const markers = parseJsonEntry<{ markers: Array<Record<string, unknown>> }>(entries, "markers/markers.json").markers;
  const notes = parseJsonEntry<{ notes: Array<Record<string, unknown>> }>(entries, "notes/notes.json").notes;
  const transportEvents = parseJsonEntry<{ events: Array<Record<string, unknown>> }>(entries, "transport/events.json").events;
  const integrityReceipt = parseJsonEntry<EvidenceCaptureIntegrityReceipt>(entries, "transport/integrity-receipt.json");
  const transportProvenance = parseJsonEntry<EvidenceTransportProvenanceDocument>(
    entries,
    "transport/provenance.json",
  );
  const transportJournal = parseJsonEntry<EvidenceTransportJournalDocument>(entries, "transport/journal.json");

  assert(Array.isArray(diagnostics));
  assert(Array.isArray(markers));
  assert(Array.isArray(notes));
  assert(Array.isArray(transportEvents));
  const artifactsByPath = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  assert.equal(artifactsByPath.get("transport/events.json")?.recordCount, transportEvents.length);
  assert.equal(artifactsByPath.get("transport/integrity-receipt.json")?.recordCount, 1);
  assert.equal(artifactsByPath.get("transport/provenance.json")?.recordCount, 1);
  assert.equal(
    artifactsByPath.get("transport/journal.json")?.recordCount,
    transportJournal.availability === "available" ? transportJournal.journal.entries.length : 0,
  );
  verifyTransportEvidence(manifest, transportProvenance, transportJournal, integrityReceipt, rawRecords);

  return {
    paths,
    manifest,
    rawRecords,
    decodedRecordCount,
    diagnostics,
    markers,
    notes,
    transportEvents,
    integrityReceipt,
    transportProvenance,
    transportJournal,
  };
}
