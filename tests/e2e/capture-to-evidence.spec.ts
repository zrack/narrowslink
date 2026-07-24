import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { verifyEvidenceBundle } from "./support/archive";
import {
  startLoopbackBridge,
  type BridgeCaptureJournal,
  type LoopbackBridge,
} from "./support/bridge";

interface CapturedUdpEndpoint {
  address: string;
  port: number;
  family: "IPv4" | "IPv6";
}

interface CapturedRecord {
  id: string;
  offsetUs: number;
  dataHex: string;
  captureBytes: number;
  transport: {
    kind: "udp";
    remoteEndpoint?: CapturedUdpEndpoint;
  };
}

interface CapturedSessionDocument {
  id: string;
  title: string;
  formatVersion: number;
  durationUs: number;
  source: {
    id: string;
    kind: "udp";
  };
  records: CapturedRecord[];
  captureIntegrity: {
    status: string;
    assessmentBasis: string;
    issueCodes: string[];
  };
  transportProvenance: {
    schemaVersion: number;
    sourceId: string;
    transport: "udp";
    status: "verified" | "incomplete";
    issueCodes: string[];
    journal: BridgeCaptureJournal | null;
    endpointAttribution: {
      totalRecords: number;
      attributedRecords: number;
      unattributedRecords: number;
      distinctEndpoints: CapturedUdpEndpoint[];
    };
  };
}

interface TransportProvenanceArchiveDocument {
  format: "narrowslink/transport-provenance";
  formatVersion: number;
  availability: "available";
  sessionFormatVersion: number;
  sourceId: string;
  transport: "udp";
  provenance: CapturedSessionDocument["transportProvenance"];
}

interface TransportJournalArchiveDocument {
  format: "narrowslink/transport-journal";
  formatVersion: number;
  availability: "available";
  sessionFormatVersion: number;
  sourceId: string;
  transport: "udp";
  captureId: string;
  journal: BridgeCaptureJournal;
}

const CAPTURE_TITLE = "Release gate UDP capture";
const RANGE_TITLE = "Exact UDP evidence range";
const MARKER_TITLE = "Operator observed transition";
const OPERATOR_NOTE = "Release gate note retained with the exact authored range.";
const EXPECTED_ARCHIVE_PATHS = [
  "SHA256SUMS",
  "decoded/packets.csv",
  "diagnostics/diagnostics.csv",
  "diagnostics/diagnostics.json",
  "manifest.json",
  "markers/markers.json",
  "notes/notes.json",
  "raw/source-records.ndjson",
  "schema/schema.json",
  "transport/events.json",
  "transport/integrity-receipt.json",
  "transport/journal.json",
  "transport/provenance.json",
].sort((left, right) => left.localeCompare(right));

function formatOffsetUsInput(offsetUs: number): string {
  const hours = Math.floor(offsetUs / 3_600_000_000);
  const minutes = Math.floor((offsetUs % 3_600_000_000) / 60_000_000);
  const seconds = Math.floor((offsetUs % 60_000_000) / 1_000_000);
  const microseconds = offsetUs % 1_000_000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${microseconds.toString().padStart(6, "0")}`;
}

async function expectFocusInside(page: Page, selector: "dialog" | "main"): Promise<void> {
  await expect.poll(() => page.evaluate((target) => {
    const active = document.activeElement;
    const container = document.querySelector(target === "dialog" ? "[role='dialog']" : "main");
    return active !== null
      && active !== document.body
      && active !== document.documentElement
      && container?.contains(active) === true;
  }, selector)).toBe(true);
}

function jsonArchiveEntry<T>(entries: Record<string, Uint8Array>, path: string): T {
  const bytes = entries[path];
  if (!bytes) throw new Error(`Archive is missing ${path}.`);
  return JSON.parse(strFromU8(bytes)) as T;
}

let bridge: LoopbackBridge | undefined;

test.afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

test("records UDP, replays and investigates it, then exports independently verifiable evidence", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  bridge = await startLoopbackBridge();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Harbor relay downlink", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /Live capture UDP or serial/ }).click();
  const captureDialog = page.getByRole("dialog", { name: "Record live telemetry" });
  await expect(captureDialog).toBeVisible();
  await captureDialog.getByLabel("Session title", { exact: true }).fill(CAPTURE_TITLE);
  await captureDialog.getByLabel(/Display timezone/).fill("UTC");
  await captureDialog.getByLabel(/Bridge URL/).fill(bridge.controlUrl);
  await captureDialog.getByLabel("Bridge token", { exact: true }).fill(bridge.token);
  await captureDialog.getByLabel("UDP bind host", { exact: true }).fill("127.0.0.1");
  await captureDialog.getByLabel(/UDP port/).fill("0");
  await captureDialog.getByRole("button", { name: "Start UDP capture" }).click();
  await expect(captureDialog.getByRole("region", { name: "Recording" })).toBeVisible();
  await expectFocusInside(page, "dialog");

  await bridge.waitForStatus((status) => status.state === "capturing" && (status.udp?.port ?? 0) > 0);
  const sent = await bridge.sendFixtureDatagrams({ count: 12, intervalMs: 10 });
  const sentBytes = sent.reduce((total, datagram) => total + datagram.byteLength, 0);
  await bridge.waitForStatus((status) => status.capture?.datagrams === sent.length && status.capture.bytes === sentBytes);
  await expect(captureDialog.getByText("Datagrams received", { exact: true }).locator("..")).toContainText(String(sent.length));
  await expect(captureDialog.getByText("Input bytes", { exact: true }).locator("..")).toContainText(`${sentBytes} B`);
  await expect(captureDialog.getByText("Records retained", { exact: true }).locator("..")).toContainText(String(sent.length));
  await bridge.waitForStatus((status) => (status.capture?.durationUs ?? 0) >= 1_500_000);

  const sessionDownloadPromise = page.waitForEvent("download");
  await captureDialog.getByRole("button", { name: "Stop, save & replay" }).click();
  const sessionDownload = await sessionDownloadPromise;
  expect(sessionDownload.suggestedFilename()).toMatch(/^narrowslink-release-gate-udp-capture-.*\.nlsession$/);
  const sessionPath = testInfo.outputPath("captured-session.nlsession");
  await sessionDownload.saveAs(sessionPath);

  const captureHeading = page.getByRole("heading", { name: CAPTURE_TITLE, level: 1 });
  await expect(captureHeading).toBeVisible();
  await expect(captureHeading).toBeFocused();
  await expectFocusInside(page, "main");
  const terminalBridgeStatus = await bridge.waitForStatus((status) => (
    status.state === "stopped" && status.captureJournal?.state === "clean"
  ));
  const terminalJournal = terminalBridgeStatus.captureJournal;
  expect(terminalJournal).not.toBeNull();
  if (!terminalJournal) throw new Error("Bridge did not preserve its terminal capture journal.");
  expect(terminalJournal).toMatchObject({
    captureId: terminalBridgeStatus.capture?.id,
    startedAt: terminalBridgeStatus.capture?.startedAt,
    endedAt: terminalBridgeStatus.capture?.endedAt,
    state: "clean",
    bind: {
      requestedHost: "127.0.0.1",
      requestedPort: 0,
      host: "127.0.0.1",
      port: terminalBridgeStatus.udp?.port,
      family: "IPv4",
    },
    multicast: null,
    datagrams: sent.length,
    bytes: sentBytes,
    kernelDroppedDatagrams: null,
    kernelDroppedDatagramsSource: "unavailable",
    entriesComplete: true,
    omittedEntries: 0,
  });
  expect(terminalJournal.entries.map((entry) => entry.type)).toEqual(["capture-started", "capture-stopped"]);
  expect(terminalJournal.entries.at(-1)).toMatchObject({
    datagrams: sent.length,
    bytes: sentBytes,
  });
  const savedSessionButton = page.getByRole("button", {
    name: new RegExp(`^(?:Reopen current|Open) saved session ${CAPTURE_TITLE},`),
  });
  await expect(savedSessionButton).toHaveCount(1);
  await expect(savedSessionButton).toContainText("Verified");

  const document = JSON.parse(await readFile(sessionPath, "utf8")) as CapturedSessionDocument;
  expect(document).toMatchObject({ title: CAPTURE_TITLE, formatVersion: 2 });
  expect(document.records).toHaveLength(sent.length);
  expect(document.records.map((record) => record.dataHex.toLowerCase())).toEqual(
    sent.map((datagram) => datagram.dataHex),
  );
  expect(document.captureIntegrity).toMatchObject({
    status: "verified",
    assessmentBasis: "udp-bridge-reconciled",
    issueCodes: [],
  });
  const endpoints = document.records.map((record) => record.transport.remoteEndpoint);
  expect(endpoints.every((endpoint) => endpoint !== undefined)).toBe(true);
  const remoteEndpoint = endpoints[0];
  if (!remoteEndpoint) throw new Error("Captured UDP records are missing their remote endpoint.");
  expect(remoteEndpoint).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
  expect(remoteEndpoint.port).toBeGreaterThan(0);
  expect(endpoints).toEqual(Array.from({ length: sent.length }, () => remoteEndpoint));
  expect(document.transportProvenance).toEqual({
    schemaVersion: 1,
    sourceId: document.source.id,
    transport: "udp",
    status: "verified",
    issueCodes: ["udp-kernel-drop-counter-unavailable"],
    journal: terminalJournal,
    endpointAttribution: {
      totalRecords: sent.length,
      attributedRecords: sent.length,
      unattributedRecords: 0,
      distinctEndpoints: [remoteEndpoint],
    },
  });

  const startRecord = document.records[2];
  const endRecord = document.records[8];
  expect(startRecord).toBeDefined();
  expect(endRecord).toBeDefined();
  if (!startRecord || !endRecord) throw new Error("Capture did not retain enough records for an exact range.");
  expect(endRecord.offsetUs).toBeGreaterThan(startRecord.offsetUs);
  const expectedRangeRecords = document.records.filter(
    (record) => record.offsetUs >= startRecord.offsetUs && record.offsetUs < endRecord.offsetUs,
  );
  expect(expectedRangeRecords[0]?.id).toBe(startRecord.id);
  expect(expectedRangeRecords.some((record) => record.id === endRecord.id)).toBe(false);

  await page.getByLabel("Choose a local NarrowsLink replay").setInputFiles(sessionPath);
  await expect(captureHeading).toBeVisible();
  await expect(savedSessionButton).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Remove saved session ${CAPTURE_TITLE}` })).toHaveCount(1);

  const replaySpeed = page.getByLabel("Replay speed");
  await replaySpeed.selectOption("2");
  await expect(replaySpeed).toHaveValue("2");
  const replayPosition = page.getByRole("slider", { name: "Replay position" });
  const replaySeekOffsetUs = 1_000_000;
  expect(document.durationUs).toBeGreaterThan(replaySeekOffsetUs);
  await replayPosition.fill(String(replaySeekOffsetUs));
  await expect(replayPosition).toHaveValue(String(replaySeekOffsetUs));
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("button", { name: "Replay again" })).toBeVisible();

  await page.getByRole("button", { name: "New range" }).click();
  const rangeDialog = page.getByRole("dialog", { name: "Define an incident range" });
  await rangeDialog.getByLabel("Title", { exact: true }).fill(RANGE_TITLE);
  await rangeDialog.getByLabel(/^Start · included/).fill(formatOffsetUsInput(startRecord.offsetUs));
  await rangeDialog.getByLabel(/^End · excluded/).fill(formatOffsetUsInput(endRecord.offsetUs));
  await rangeDialog.getByRole("combobox", { name: "Severity" }).selectOption("critical");
  await rangeDialog.getByRole("button", { name: "Create range" }).click();
  await expect(page.getByRole("heading", { name: RANGE_TITLE, level: 2 })).toBeVisible();
  await expect(page.getByLabel("Selected incident")).toHaveValue(/^operator-/);

  await page.getByRole("tab", { name: /^provenance$/i }).click();
  const provenancePanel = page.getByRole("tabpanel", { name: /^provenance$/i });
  await expect(provenancePanel.getByRole("heading", { name: "UDP provenance" })).toBeVisible();
  await expect(provenancePanel.getByText("verified", { exact: true })).toBeVisible();
  await expect(provenancePanel).toContainText(terminalJournal.captureId);
  await expect(provenancePanel).toContainText(`${sent.length} / ${sent.length} records · 1 endpoint`);
  await expect(provenancePanel).toContainText(`${sent.length} datagrams`);
  await expect(provenancePanel).toContainText("Unavailable · bridge API");
  await expect(provenancePanel).toContainText("clean · 2 entries");
  const endpointEvidence = provenancePanel.getByRole("region", { name: "Remote endpoints in selected incident" });
  await expect(endpointEvidence).toContainText(`127.0.0.1:${remoteEndpoint.port}`);
  await expect(endpointEvidence).toContainText(`${expectedRangeRecords.length} records`);
  await expect(provenancePanel.getByRole("region", { name: "Bridge journal entries in selected incident" }))
    .toContainText("Whole-session state: clean");
  await expect(provenancePanel.getByRole("region", { name: "UDP provenance boundaries" }))
    .toContainText("udp-kernel-drop-counter-unavailable");

  const markerOffsetUs = Math.floor(((startRecord.offsetUs + endRecord.offsetUs) / 2) / 1_000) * 1_000;
  expect(markerOffsetUs).toBeGreaterThan(startRecord.offsetUs);
  expect(markerOffsetUs).toBeLessThan(endRecord.offsetUs);
  await page.getByRole("button", { name: "Add marker" }).click();
  const markerDialog = page.getByRole("dialog", { name: "Add an operator marker" });
  await markerDialog.getByLabel(/^Offset from session start/).fill((markerOffsetUs / 1_000_000).toFixed(3));
  await markerDialog.getByLabel("Title", { exact: true }).fill(MARKER_TITLE);
  await markerDialog.getByRole("combobox", { name: "Category" }).selectOption("observation");
  await markerDialog.getByLabel("Note", { exact: true }).fill("Marker falls inside the selected half-open range.");
  await markerDialog.getByRole("button", { name: "Add marker" }).click();
  await expect(page.getByRole("region", { name: "Session overview" })).toContainText("1 operator marker");

  const sessionNote = page.getByLabel("Session-wide operator note");
  await sessionNote.fill(OPERATOR_NOTE);
  await expect(sessionNote).toHaveValue(OPERATOR_NOTE);

  const bundlePanel = page.getByRole("region", { name: "Incident bundle preview" });
  await bundlePanel.getByRole("button", { name: "Create incident bundle" }).click();
  const bundleDialog = page.getByRole("dialog", { name: "Package this incident for handoff?" });
  const bundleDownloadPromise = page.waitForEvent("download");
  await bundleDialog.getByRole("button", { name: "Build and download" }).click();
  const bundleDownload = await bundleDownloadPromise;
  expect(bundleDownload.suggestedFilename()).toMatch(/\.nlb$/);
  const bundlePath = testInfo.outputPath("exact-range-evidence.nlb");
  await bundleDownload.saveAs(bundlePath);
  const readyBundleDialog = page.getByRole("dialog", { name: "Handoff archive is ready" });
  await expect(readyBundleDialog).toBeVisible();

  const archive = await verifyEvidenceBundle(bundlePath);
  const archiveEntries = unzipSync(new Uint8Array(await readFile(bundlePath)));
  const provenanceDocument = jsonArchiveEntry<TransportProvenanceArchiveDocument>(
    archiveEntries,
    "transport/provenance.json",
  );
  const journalDocument = jsonArchiveEntry<TransportJournalArchiveDocument>(
    archiveEntries,
    "transport/journal.json",
  );
  const manifest = archive.manifest as typeof archive.manifest & {
    provenance: {
      availability: string;
      status: string;
      sourceId: string;
      transport: string;
      issueCodes: string[];
      captureId: string | null;
      endpointAttribution: {
        totalRecords: number;
        attributedRecords: number;
        unattributedRecords: number;
        distinctEndpointCount: number;
      } | null;
      journal: {
        availability: string;
        reason: string | null;
        state: string | null;
        entriesComplete: boolean | null;
        entryCount: number;
        omittedEntries: number;
      };
    };
  };
  expect(archive.paths).toEqual(EXPECTED_ARCHIVE_PATHS);
  expect(manifest).toMatchObject({
    format: "narrowslink/evidence-bundle",
    formatVersion: 3,
    session: {
      id: document.id,
      title: CAPTURE_TITLE,
      captureIntegrity: document.captureIntegrity,
    },
    provenance: {
      availability: "available",
      status: "verified",
      sourceId: document.source.id,
      transport: "udp",
      issueCodes: ["udp-kernel-drop-counter-unavailable"],
      captureId: terminalJournal.captureId,
      endpointAttribution: {
        totalRecords: sent.length,
        attributedRecords: sent.length,
        unattributedRecords: 0,
        distinctEndpointCount: 1,
      },
      journal: {
        availability: "available",
        reason: null,
        state: "clean",
        entriesComplete: true,
        entryCount: 2,
        omittedEntries: 0,
      },
    },
    selection: {
      id: expect.stringMatching(/^operator-/),
      title: RANGE_TITLE,
      severity: "critical",
      startUs: startRecord.offsetUs,
      endUs: endRecord.offsetUs,
      rangeSemantics: "half-open [startUs, endUs)",
    },
    inclusions: {
      rawRecords: true,
      decodedPackets: true,
      diagnostics: true,
      markers: true,
      notes: true,
      schema: true,
      transportEvidence: true,
    },
  });
  expect(provenanceDocument).toEqual({
    format: "narrowslink/transport-provenance",
    formatVersion: 1,
    availability: "available",
    sessionFormatVersion: 2,
    sourceId: document.source.id,
    transport: "udp",
    provenance: document.transportProvenance,
  });
  expect(journalDocument).toEqual({
    format: "narrowslink/transport-journal",
    formatVersion: 1,
    availability: "available",
    sessionFormatVersion: 2,
    sourceId: document.source.id,
    transport: "udp",
    captureId: terminalJournal.captureId,
    journal: terminalJournal,
  });
  expect(archive.rawRecords.map((record) => record.id)).toEqual(expectedRangeRecords.map((record) => record.id));
  expect(archive.rawRecords.map((record) => record.dataHex)).toEqual(expectedRangeRecords.map((record) => record.dataHex));
  expect((archive.rawRecords as CapturedRecord[]).map((record) => record.transport.remoteEndpoint))
    .toEqual(expectedRangeRecords.map((record) => record.transport.remoteEndpoint));
  expect(archive.rawRecords.every(
    (record) => record.offsetUs >= startRecord.offsetUs && record.offsetUs < endRecord.offsetUs,
  )).toBe(true);
  expect(archive.rawRecords.some((record) => record.id === startRecord.id)).toBe(true);
  expect(archive.rawRecords.some((record) => record.id === endRecord.id)).toBe(false);
  expect(archive.decodedRecordCount).toBe(expectedRangeRecords.length);
  expect(archive.markers).toEqual([
    expect.objectContaining({ title: MARKER_TITLE, offsetUs: markerOffsetUs, category: "observation" }),
  ]);
  expect(archive.notes).toEqual([
    expect.objectContaining({ id: "operator-note", title: "Operator note", body: OPERATOR_NOTE }),
  ]);
  expect(archive.integrityReceipt).toEqual(document.captureIntegrity);
  expect(archive.transportEvents).toEqual([]);

  const artifactCounts = new Map(archive.manifest.artifacts.map((artifact) => [artifact.path, artifact.recordCount]));
  expect(artifactCounts.get("raw/source-records.ndjson")).toBe(expectedRangeRecords.length);
  expect(artifactCounts.get("decoded/packets.csv")).toBe(expectedRangeRecords.length);
  expect(artifactCounts.get("diagnostics/diagnostics.json")).toBe(archive.diagnostics.length);
  expect(artifactCounts.get("diagnostics/diagnostics.csv")).toBe(archive.diagnostics.length);
  expect(artifactCounts.get("markers/markers.json")).toBe(1);
  expect(artifactCounts.get("notes/notes.json")).toBe(1);
  expect(artifactCounts.get("transport/events.json")).toBe(0);
  expect(artifactCounts.get("transport/integrity-receipt.json")).toBe(1);
  expect(artifactCounts.get("transport/provenance.json")).toBe(1);
  expect(artifactCounts.get("transport/journal.json")).toBe(terminalJournal.entries.length);

  await readyBundleDialog.getByRole("button", { name: "Return to session" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbor relay downlink", level: 1 })).toBeVisible();
  const reopenButton = page.getByRole("button", {
    name: new RegExp(`^Open saved session ${CAPTURE_TITLE},`),
  });
  await expect(reopenButton).toBeVisible();
  await reopenButton.click();
  await expect(captureHeading).toBeVisible();
  await page.getByLabel("Selected incident").selectOption({ label: RANGE_TITLE });
  await expect(page.getByRole("heading", { name: RANGE_TITLE, level: 2 })).toBeVisible();
  await expect(page.getByLabel("Session-wide operator note")).toHaveValue(OPERATOR_NOTE);
  await expect(page.getByRole("region", { name: "Session overview" })).toContainText("1 operator marker");
  await page.getByRole("tab", { name: /^provenance$/i }).click();
  await expect(provenancePanel).toContainText(terminalJournal.captureId);
  await expect(provenancePanel).toContainText("clean · 2 entries");
  await expect(provenancePanel.getByRole("region", { name: "Remote endpoints in selected incident" }))
    .toContainText(`127.0.0.1:${remoteEndpoint.port}`);

  await page.getByRole("button", { name: `Remove saved session ${CAPTURE_TITLE}` }).click();
  const removal = page.getByRole("group", { name: `Confirm removal of ${CAPTURE_TITLE}` });
  await expect(removal).toBeVisible();
  await removal.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No saved sessions yet.", { exact: true })).toBeVisible();
  await expect(captureHeading).toBeVisible();
  await expect(page.getByLabel("Session-wide operator note")).toHaveValue(OPERATOR_NOTE);
  await expect(page.getByText(/Removed from browser storage; save this replay again/)).toBeVisible();
  expect(await page.evaluate((note) => Object.keys(localStorage).some(
    (key) => localStorage.getItem(key)?.includes(note) === true,
  ), OPERATOR_NOTE)).toBe(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbor relay downlink", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`saved session ${CAPTURE_TITLE},`, "i") })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
