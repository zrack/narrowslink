import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { DownloadSimple, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";

import type { SessionDocument } from "../domain/types";
import { serializeSessionDocument } from "../data/session-file";
import { formatBytes, formatDurationUs } from "../lib/time";
import { Nsl01SerialFrameAssembler } from "./nsl01-serial-assembler";
import {
  CaptureRecorder,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_RECORDS,
  type CapturedBytes,
} from "./recorder";
import {
  DEFAULT_UDP_BRIDGE_URL,
  UdpBridgeClient,
  UdpBridgeProtocolError,
  type UdpBridgeDatagram,
  type UdpBridgeErrorDetail,
  type UdpBridgeStatus,
} from "./udp-bridge";
import {
  getBrowserSerialApi,
  WebSerialCapture,
  type SerialFlowControl,
  type SerialParity,
} from "./web-serial";

type CaptureTransport = "udp" | "serial";
type CapturePhase = "ready" | "starting" | "canceling" | "capturing" | "stopping" | "saving" | "save-error" | "finalize-error";
type SerialConnectionState = "idle" | "selecting" | "open" | "disconnected" | "closed" | "error";

interface CaptureTotals {
  inputUnits: number;
  inputBytes: number;
  records: number;
  recordedBytes: number;
}

interface PendingUdpRecorderConfig {
  sessionId: string;
  title: string;
  displayTimeZone: string;
}

interface PendingFinalization {
  durationUs: number;
  incompleteReason: string | null;
}

export interface CaptureDialogProps {
  onClose: () => void;
  onComplete: (session: SessionDocument) => void | Promise<void>;
  displayTimeZone?: string;
}

const EMPTY_TOTALS: CaptureTotals = Object.freeze({
  inputUnits: 0,
  inputBytes: 0,
  records: 0,
  recordedBytes: 0,
});

const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function nowMonotonicMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function monotonicCaptureDurationUs(
  captureStartMs: number,
  currentMs: number,
  lastObservedUs: number,
  bridgeDurationUs = 0,
): number {
  const wallDurationUs = captureStartMs > 0
    ? Math.max(0, Math.floor((currentMs - captureStartMs) * 1_000))
    : 0;
  return Math.max(0, lastObservedUs, bridgeDurationUs, wallDurationUs);
}

export function verifiedCaptureDurationUs(input: {
  frozenDurationUs: number;
  bridgeDurationUs?: number;
  bridgeDatagrams?: number;
  lastRetainedOffsetUs: number;
}): number {
  const bridgeEndUs = (input.bridgeDurationUs ?? 0) + ((input.bridgeDatagrams ?? 0) > 0 ? 1 : 0);
  return Math.max(1, input.frozenDurationUs, bridgeEndUs, input.lastRetainedOffsetUs + 1);
}

export function boundFinalizationDuration(
  requestedDurationUs: number,
  maximumDurationUs: number,
): { durationUs: number; wasCapped: boolean } {
  return requestedDurationUs > maximumDurationUs
    ? { durationUs: maximumDurationUs, wasCapped: true }
    : { durationUs: requestedDurationUs, wasCapped: false };
}

function createSessionId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `capture-${Date.now().toString(36)}-${random}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

function udpErrorMessage(error: UdpBridgeErrorDetail | UdpBridgeProtocolError): string {
  if (error instanceof UdpBridgeProtocolError) return `${error.message} (${error.code})`;
  return `${error.message} (${error.code}${error.fatal ? ", fatal" : ""})`;
}

export class UdpCaptureOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UdpCaptureOwnershipError";
  }
}

export class UdpCaptureIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UdpCaptureIntegrityError";
  }
}

interface UdpStopClient {
  getStatus(): Promise<UdpBridgeStatus>;
  stop(): Promise<UdpBridgeStatus>;
}

export interface UdpCaptureIntegritySnapshot {
  observedDatagrams: number;
  observedBytes: number;
  retainedRecords: number;
  retainedBytes: number;
  lastSequence: number;
  sequenceIssue: string | null;
}

/**
 * Refreshes status before issuing the global bridge stop command. The command
 * is never sent unless the currently reported capture ID is the one returned
 * by this dialog's successful start request.
 */
export async function stopUdpCaptureIfOwned(
  client: UdpStopClient,
  ownedCaptureId: string,
): Promise<UdpBridgeStatus> {
  const current = await client.getStatus();
  if (current.capture?.id !== ownedCaptureId) {
    throw new UdpCaptureOwnershipError(
      "The bridge is no longer running this dialog's UDP capture. It was left untouched; verify the bridge before continuing.",
    );
  }
  if (current.state === "stopped" || current.state === "idle") return current;
  const stopped = await client.stop();
  if (stopped.capture?.id !== ownedCaptureId) {
    throw new UdpCaptureOwnershipError(
      "The bridge stop response identified a different capture. Clean save was refused.",
    );
  }
  return stopped;
}

/** Refuses a clean session when bridge, event-stream, or recorder totals differ. */
export function assertUdpCaptureIntegrity(
  status: UdpBridgeStatus,
  ownedCaptureId: string,
  snapshot: UdpCaptureIntegritySnapshot,
): void {
  const capture = status.capture;
  if (!capture || capture.id !== ownedCaptureId) {
    throw new UdpCaptureIntegrityError(
      "UDP capture integrity check failed: the stop response did not identify the capture owned by this dialog. Clean save was refused.",
    );
  }

  const expectedLastSequence = capture.datagrams - 1;
  const failures: string[] = [];
  if (status.state !== "stopped") {
    failures.push(`the bridge ended in ${status.state} state instead of stopped`);
  }
  if (status.lastError?.fatal) {
    failures.push(`the bridge reported fatal ${status.lastError.code}: ${status.lastError.message}`);
  }
  if (snapshot.observedDatagrams !== capture.datagrams) {
    failures.push(`bridge recorded ${capture.datagrams.toLocaleString()} datagrams but the browser received ${snapshot.observedDatagrams.toLocaleString()}`);
  }
  if (snapshot.observedBytes !== capture.bytes) {
    failures.push(`bridge recorded ${capture.bytes.toLocaleString()} bytes but the browser received ${snapshot.observedBytes.toLocaleString()}`);
  }
  if (snapshot.retainedRecords !== snapshot.observedDatagrams) {
    failures.push(`the recorder retained ${snapshot.retainedRecords.toLocaleString()} records for ${snapshot.observedDatagrams.toLocaleString()} received datagrams`);
  }
  if (snapshot.retainedBytes !== snapshot.observedBytes) {
    failures.push(`the recorder retained ${snapshot.retainedBytes.toLocaleString()} of ${snapshot.observedBytes.toLocaleString()} received bytes`);
  }
  if (snapshot.sequenceIssue) failures.push(snapshot.sequenceIssue);
  if (snapshot.lastSequence !== expectedLastSequence) {
    failures.push(`the final SSE sequence was ${snapshot.lastSequence}, expected ${expectedLastSequence}`);
  }
  if (failures.length > 0) {
    throw new UdpCaptureIntegrityError(
      `UDP capture integrity check failed; clean save was refused because ${failures.join("; ")}. Check the local bridge event stream and record a new capture.`,
    );
  }
}

function markCaptureRecoveryIncomplete(session: SessionDocument): SessionDocument {
  return {
    ...session,
    // Replace the recorder's existing incident instead of growing a document
    // that was already budgeted against the exact 32 MiB serialized limit.
    incidents: session.incidents.map((incident) => incident.id === "capture-interval"
      ? { ...incident, title: "Incomplete", severity: "warning" as const }
      : incident),
  };
}

function strictInteger(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a whole number from ${minimum.toLocaleString()} to ${maximum.toLocaleString()}.`);
  }
  return parsed;
}

function validateTimeZone(value: string): string {
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(0);
  } catch {
    throw new Error("Display timezone must be a valid IANA timezone name, such as America/Los_Angeles.");
  }
  return normalized;
}

function downloadSession(session: SessionDocument): string {
  const json = serializeSessionDocument(session);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "capture";
  const timestamp = session.startedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const filename = `narrowslink-${slug}-${timestamp}.nlsession`;
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return filename;
}

function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  canClose: boolean,
  onBlockedClose: () => void,
): void {
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const onBlockedCloseRef = useRef(onBlockedClose);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;
  onBlockedCloseRef.current = onBlockedClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const previousInert = appRoot?.inert ?? false;
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }

    const frame = requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>("[data-dialog-focus]")
        ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? dialog;
      initial.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (canCloseRef.current) onCloseRef.current();
        else onBlockedCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (appRoot) {
        appRoot.inert = previousInert;
        if (previousAriaHidden == null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      opener?.focus({ preventScroll: true });
    };
  }, [dialogRef]);
}

function capturePhaseLabel(phase: CapturePhase, transport: CaptureTransport, issue: string): string {
  if (phase === "starting") return transport === "udp" ? "Connecting to bridge" : "Selecting serial device";
  if (phase === "canceling") return "Capture setup cancelled";
  if (phase === "capturing") return issue ? "Recording with attention required" : "Recording";
  if (phase === "stopping") return "Stopping transport";
  if (phase === "saving") return "Saving local session";
  if (phase === "save-error") return "Finalized session awaiting download";
  if (phase === "finalize-error") return "Retained capture awaiting recovery";
  return "Ready";
}

export function CaptureDialog({ onClose, onComplete, displayTimeZone }: CaptureDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const udpTabRef = useRef<HTMLButtonElement>(null);
  const serialTabRef = useRef<HTMLButtonElement>(null);
  const discardKeepRef = useRef<HTMLButtonElement>(null);
  const transportRef = useRef<CaptureTransport | null>(null);
  const recorderRef = useRef<CaptureRecorder | null>(null);
  const udpClientRef = useRef<UdpBridgeClient | null>(null);
  const udpStatusRef = useRef<UdpBridgeStatus | null>(null);
  const udpRecorderConfigRef = useRef<PendingUdpRecorderConfig | null>(null);
  // Set only from this dialog's successful POST /start response.
  const ownedUdpCaptureIdRef = useRef<string | null>(null);
  const pendingUdpDatagramsRef = useRef<UdpBridgeDatagram[]>([]);
  const pendingUdpBytesRef = useRef(0);
  const observedUdpDatagramsRef = useRef(0);
  const observedUdpBytesRef = useRef(0);
  const lastUdpSequenceRef = useRef(-1);
  const udpSequenceIssueRef = useRef<string | null>(null);
  const transportIntegrityIssueRef = useRef<string | null>(null);
  const serialCaptureRef = useRef<WebSerialCapture | null>(null);
  const serialAssemblerRef = useRef<Nsl01SerialFrameAssembler | null>(null);
  const serialDisconnectedRef = useRef(false);
  const observedSerialReadsRef = useRef(0);
  const observedSerialBytesRef = useRef(0);
  const captureStartMsRef = useRef(0);
  const lastDurationUsRef = useRef(0);
  const lastRetainedOffsetUsRef = useRef(-1);
  const verifiedStopDurationUsRef = useRef(0);
  const durationFrozenRef = useRef(false);
  const frozenDurationUsRef = useRef(0);
  const captureInputClosedRef = useRef(false);
  const ingestPausedRef = useRef(false);
  const finalizingRef = useRef(false);
  const startCancelledRef = useRef(false);
  const pendingFinalizedSessionRef = useRef<SessionDocument | null>(null);
  const pendingFinalizationRef = useRef<PendingFinalization | null>(null);
  const mountedRef = useRef(true);

  const id = useId().replace(/:/g, "");
  const titleId = `capture-dialog-title-${id}`;
  const descriptionId = `capture-dialog-description-${id}`;
  const statusId = `capture-status-${id}`;
  const errorId = `capture-error-${id}`;
  const udpPanelId = `capture-udp-panel-${id}`;
  const serialPanelId = `capture-serial-panel-${id}`;
  const udpTabId = `capture-udp-tab-${id}`;
  const serialTabId = `capture-serial-tab-${id}`;

  const [transport, setTransport] = useState<CaptureTransport>("udp");
  const [phase, setPhase] = useState<CapturePhase>("ready");
  const [sessionTitle, setSessionTitle] = useState("Live telemetry capture");
  const [timeZone, setTimeZone] = useState(displayTimeZone ?? browserTimeZone());
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_UDP_BRIDGE_URL);
  const [bridgeToken, setBridgeToken] = useState("");
  const [udpHost, setUdpHost] = useState("127.0.0.1");
  const [udpPort, setUdpPort] = useState("9104");
  const [multicastGroup, setMulticastGroup] = useState("");
  const [multicastInterface, setMulticastInterface] = useState("");
  const [baudRate, setBaudRate] = useState("115200");
  const [dataBits, setDataBits] = useState<"7" | "8">("8");
  const [stopBits, setStopBits] = useState<"1" | "2">("1");
  const [parity, setParity] = useState<SerialParity>("none");
  const [flowControl, setFlowControl] = useState<SerialFlowControl>("none");
  const [totals, setTotals] = useState<CaptureTotals>(EMPTY_TOTALS);
  const [udpStatus, setUdpStatus] = useState<UdpBridgeStatus | null>(null);
  const [serialState, setSerialState] = useState<SerialConnectionState>("idle");
  const [serialDevice, setSerialDevice] = useState("Not selected");
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [timerTick, setTimerTick] = useState(0);

  const captureLocked = phase !== "ready";
  const canDismiss = phase === "ready" || phase === "canceling";
  const serialAvailable = useMemo(() => getBrowserSerialApi() != null, []);
  const elapsedUs = (() => {
    if (durationFrozenRef.current) return frozenDurationUsRef.current;
    if (captureStartMsRef.current === 0) return lastDurationUsRef.current;
    if (transportRef.current === "udp") {
      return monotonicCaptureDurationUs(
        captureStartMsRef.current,
        nowMonotonicMs(),
        lastDurationUsRef.current,
        udpStatus?.capture?.durationUs ?? 0,
      );
    }
    if (phase === "capturing" || phase === "starting") {
      return monotonicCaptureDurationUs(captureStartMsRef.current, nowMonotonicMs(), lastDurationUsRef.current);
    }
    return lastDurationUsRef.current;
  })();
  void timerTick;

  const blockedClose = () => setNotice("Stop and save the capture, or explicitly discard it, before closing this dialog.");
  useDialogFocus(dialogRef, onClose, canDismiss, blockedClose);

  useEffect(() => {
    if (phase !== "starting" && phase !== "capturing") return;
    const flush = () => {
      const activeTransport = transportRef.current;
      const recorder = recorderRef.current;
      setTotals({
        inputUnits: activeTransport === "udp" ? observedUdpDatagramsRef.current : observedSerialReadsRef.current,
        inputBytes: activeTransport === "udp" ? observedUdpBytesRef.current : observedSerialBytesRef.current,
        records: recorder?.recordCount ?? 0,
        recordedBytes: recorder?.capturedBytes ?? 0,
      });
      setTimerTick((tick) => tick + 1);
    };
    flush();
    const timer = globalThis.setInterval(flush, 250);
    return () => globalThis.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "starting") return;
    const timeout = globalThis.setTimeout(() => {
      startCancelledRef.current = true;
      setNotice("Capture setup timed out. Any late transport open will be closed without recording; dismiss the device chooser if it remains visible.");
      udpClientRef.current?.disconnect();
      setPhase("canceling");
    }, 20_000);
    return () => globalThis.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!confirmDiscard) return;
    const frame = requestAnimationFrame(() => discardKeepRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [confirmDiscard]);

  useEffect(() => {
    // React Strict Mode intentionally performs a setup/cleanup/setup cycle in
    // development. Restore this guard in setup so a real mounted dialog keeps
    // receiving asynchronous bridge and serial state updates.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startCancelledRef.current = true;
      const udpClient = udpClientRef.current;
      const ownedCaptureId = ownedUdpCaptureIdRef.current;
      if (udpClient && ownedCaptureId) {
        void stopUdpCaptureIfOwned(udpClient, ownedCaptureId)
          .catch(() => undefined)
          .finally(() => udpClient.disconnect());
      } else {
        udpClient?.disconnect();
      }
      const serialCapture = serialCaptureRef.current;
      if (serialCapture) void serialCapture.stop().catch(() => undefined);
    };
  }, []);

  const resetForStart = (nextTransport: CaptureTransport): void => {
    transportRef.current = nextTransport;
    // The transport establishes the capture epoch: the bridge's startedAt for
    // UDP, and Web Serial's synchronous onOpen callback for serial. Device
    // selection and connection setup are deliberately excluded.
    captureStartMsRef.current = 0;
    lastDurationUsRef.current = 0;
    lastRetainedOffsetUsRef.current = -1;
    verifiedStopDurationUsRef.current = 0;
    durationFrozenRef.current = false;
    frozenDurationUsRef.current = 0;
    captureInputClosedRef.current = false;
    ingestPausedRef.current = false;
    startCancelledRef.current = false;
    pendingFinalizedSessionRef.current = null;
    pendingFinalizationRef.current = null;
    pendingUdpDatagramsRef.current = [];
    pendingUdpBytesRef.current = 0;
    observedUdpDatagramsRef.current = 0;
    observedUdpBytesRef.current = 0;
    observedSerialReadsRef.current = 0;
    observedSerialBytesRef.current = 0;
    ownedUdpCaptureIdRef.current = null;
    lastUdpSequenceRef.current = -1;
    udpSequenceIssueRef.current = null;
    transportIntegrityIssueRef.current = null;
    setTotals(EMPTY_TOTALS);
    setIssue("");
    setNotice("");
    setConfirmDiscard(false);
    setUdpStatus(null);
    udpStatusRef.current = null;
  };

  const clearRuntime = (): void => {
    recorderRef.current = null;
    udpClientRef.current = null;
    udpRecorderConfigRef.current = null;
    ownedUdpCaptureIdRef.current = null;
    lastUdpSequenceRef.current = -1;
    udpSequenceIssueRef.current = null;
    transportIntegrityIssueRef.current = null;
    pendingUdpDatagramsRef.current = [];
    pendingUdpBytesRef.current = 0;
    observedUdpDatagramsRef.current = 0;
    observedUdpBytesRef.current = 0;
    serialCaptureRef.current = null;
    serialAssemblerRef.current = null;
    serialDisconnectedRef.current = false;
    transportRef.current = null;
    ingestPausedRef.current = false;
    durationFrozenRef.current = false;
    frozenDurationUsRef.current = 0;
    captureInputClosedRef.current = false;
    startCancelledRef.current = false;
    captureStartMsRef.current = 0;
    lastRetainedOffsetUsRef.current = -1;
    verifiedStopDurationUsRef.current = 0;
  };

  const pauseIngest = (cause: unknown): void => {
    if (ingestPausedRef.current) return;
    ingestPausedRef.current = true;
    const message = errorMessage(cause, "Captured input could not be retained.");
    transportIntegrityIssueRef.current = message;
    setIssue(`${message} Recording is paused; stop to preserve the records already retained.`);
  };

  const freezeCaptureDuration = (): number => {
    if (!durationFrozenRef.current) {
      const activeTransport = transportRef.current;
      const liveDurationUs = activeTransport !== null
        ? monotonicCaptureDurationUs(captureStartMsRef.current, nowMonotonicMs(), lastDurationUsRef.current)
        : lastDurationUsRef.current;
      frozenDurationUsRef.current = Math.max(1, liveDurationUs);
      durationFrozenRef.current = true;
    }
    return frozenDurationUsRef.current;
  };

  const appendCapturedBytes = (input: CapturedBytes): void => {
    if (ingestPausedRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      recorder.append(input);
      lastRetainedOffsetUsRef.current = Math.max(lastRetainedOffsetUsRef.current, input.offsetUs);
    } catch (cause) {
      pauseIngest(cause);
    }
  };

  const acceptOwnedUdpDatagram = (datagram: UdpBridgeDatagram): void => {
    const ownedCaptureId = ownedUdpCaptureIdRef.current;
    if (!ownedCaptureId || datagram.captureId !== ownedCaptureId) {
      setIssue("The bridge emitted a datagram from a capture this dialog does not own; it was left untouched and not retained.");
      return;
    }
    const expectedSequence = lastUdpSequenceRef.current + 1;
    if (datagram.sequence !== expectedSequence && !udpSequenceIssueRef.current) {
      udpSequenceIssueRef.current = `SSE sequence ${datagram.sequence} arrived where ${expectedSequence} was expected`;
      setIssue(`UDP event-stream sequence discontinuity detected at ${datagram.sequence}; clean save will be refused.`);
    }
    lastUdpSequenceRef.current = datagram.sequence;
    if (!durationFrozenRef.current) {
      lastDurationUsRef.current = Math.max(lastDurationUsRef.current, datagram.offsetUs + 1);
    }
    observedUdpDatagramsRef.current += 1;
    observedUdpBytesRef.current += datagram.byteLength;
    if (captureInputClosedRef.current) return;
    appendCapturedBytes({
      offsetUs: datagram.offsetUs,
      bytes: datagram.data,
      wireBytes: datagram.byteLength,
    });
  };

  const establishOwnedUdpCapture = (status: UdpBridgeStatus): void => {
    if (recorderRef.current) return;
    if (status.state !== "capturing" || !status.capture || !status.udp) {
      throw new UdpCaptureOwnershipError(
        "The successful bridge start response did not identify an active capture and bind address.",
      );
    }
    const config = udpRecorderConfigRef.current;
    if (!config) throw new Error("The pending UDP session metadata is unavailable.");
    // This is the sole ownership assignment. Event-stream hello/status events
    // can describe a foreign capture, so they never reach this path.
    ownedUdpCaptureIdRef.current = status.capture.id;
    const sourceAddress = status.multicast?.group ?? status.udp.host;
    const sourceLabel = status.multicast
      ? `UDP multicast ${status.multicast.group} · ${status.udp.host}:${status.udp.port}`
      : `UDP ${status.udp.host}:${status.udp.port}`;
    const recorder = new CaptureRecorder({
      sessionId: config.sessionId,
      title: config.title,
      startedAt: status.capture.startedAt,
      displayTimeZone: config.displayTimeZone,
      source: {
        id: `live-udp-${config.sessionId}`.slice(0, 128),
        kind: "udp",
        label: sourceLabel.slice(0, 200),
        address: sourceAddress,
        port: status.udp.port,
      },
    });
    recorderRef.current = recorder;
    captureStartMsRef.current = nowMonotonicMs() - status.capture.durationUs / 1_000;

    const pending = pendingUdpDatagramsRef.current;
    pendingUdpDatagramsRef.current = [];
    pendingUdpBytesRef.current = 0;
    for (const datagram of pending) {
      if (datagram.captureId !== status.capture.id) continue;
      acceptOwnedUdpDatagram(datagram);
    }
  };

  const acceptUdpStatus = (status: UdpBridgeStatus): void => {
    udpStatusRef.current = status;
    if (mountedRef.current) setUdpStatus(status);
    const ownedCaptureId = ownedUdpCaptureIdRef.current;
    if (ownedCaptureId && status.capture?.id === ownedCaptureId) {
      if (!durationFrozenRef.current) {
      lastDurationUsRef.current = Math.max(lastDurationUsRef.current, status.capture.durationUs);
      }
      if (status.lastError && mountedRef.current) setIssue(udpErrorMessage(status.lastError));
    }
  };

  const startUdpCapture = async (): Promise<void> => {
    if (captureLocked || transportRef.current) return;
    let port: number;
    let resolvedTimeZone: string;
    const title = sessionTitle.trim();
    try {
      if (!title) throw new Error("Session title is required.");
      port = strictInteger(udpPort, "UDP port", 0, 65_535);
      resolvedTimeZone = validateTimeZone(timeZone);
    } catch (cause) {
      setIssue(errorMessage(cause, "The UDP capture configuration is invalid."));
      return;
    }

    resetForStart("udp");
    udpRecorderConfigRef.current = {
      sessionId: createSessionId(),
      title,
      displayTimeZone: resolvedTimeZone,
    };
    setPhase("starting");
    let client: UdpBridgeClient;
    try {
      client = new UdpBridgeClient({
        baseUrl: bridgeUrl.trim(),
        token: bridgeToken,
        onStatus: acceptUdpStatus,
        onDatagram: (datagram) => {
          if (transportRef.current !== "udp") return;
          if (ownedUdpCaptureIdRef.current) {
            acceptOwnedUdpDatagram(datagram);
          } else if (
            pendingUdpDatagramsRef.current.length < MAX_CAPTURE_RECORDS
            && pendingUdpBytesRef.current + datagram.byteLength <= MAX_CAPTURE_BYTES
          ) {
            pendingUdpDatagramsRef.current.push(datagram);
            pendingUdpBytesRef.current += datagram.byteLength;
          } else {
            pauseIngest(new Error("Early UDP datagrams exceeded the local pre-status buffer limit."));
          }
        },
        onError: (error) => {
          const transportEnded = error instanceof UdpBridgeProtocolError
            ? error.code === "event-stream-disconnected"
            : error.fatal;
          if (ownedUdpCaptureIdRef.current && transportEnded) {
            freezeCaptureDuration();
            captureInputClosedRef.current = true;
            transportIntegrityIssueRef.current = udpErrorMessage(error);
          }
          setIssue(udpErrorMessage(error));
        },
      });
    } catch (cause) {
      clearRuntime();
      setPhase("ready");
      setIssue(errorMessage(cause, "The local UDP bridge configuration is invalid."));
      return;
    }
    udpClientRef.current = client;

    try {
      const group = multicastGroup.trim();
      const interfaceAddress = multicastInterface.trim();
      const status = await client.start({
        host: udpHost.trim(),
        port,
        ...(group ? { multicastGroup: group } : {}),
        ...(interfaceAddress ? { multicastInterface: interfaceAddress } : {}),
      });
      if (startCancelledRef.current || !mountedRef.current) {
        if (status.state === "capturing" && status.capture) {
          ownedUdpCaptureIdRef.current = status.capture.id;
          await stopUdpCaptureIfOwned(client, status.capture.id).catch(() => undefined);
        }
        client.disconnect();
        clearRuntime();
        if (mountedRef.current) {
          setPhase("ready");
          setNotice("UDP capture setup was cancelled before recording began.");
        }
        return;
      }
      // Ownership begins only after the POST /start promise resolves
      // successfully. Status/hello events observed during connect are not
      // sufficient proof and may belong to another operator.
      establishOwnedUdpCapture(status);
      acceptUdpStatus(status);
      if (mountedRef.current && transportRef.current === "udp") setPhase("capturing");
    } catch (cause) {
      const cancelled = startCancelledRef.current;
      const ownedCaptureId = ownedUdpCaptureIdRef.current;
      if (ownedCaptureId) {
        await stopUdpCaptureIfOwned(client, ownedCaptureId).catch(() => undefined);
      }
      client.disconnect();
      clearRuntime();
      if (mountedRef.current) {
        setPhase("ready");
        if (cancelled) setNotice("UDP capture setup was cancelled before recording began.");
        else setIssue(errorMessage(cause, "The UDP capture could not be started."));
      }
    }
  };

  const startSerialCapture = (): void => {
    if (captureLocked || transportRef.current) return;
    const api = getBrowserSerialApi();
    if (!api) {
      setIssue("Web Serial is unavailable in this browser. Use a supported Chromium browser or the local UDP bridge.");
      return;
    }

    let parsedBaudRate: number;
    let resolvedTimeZone: string;
    const title = sessionTitle.trim();
    const serialSessionId = createSessionId();
    try {
      if (!title) throw new Error("Session title is required.");
      parsedBaudRate = strictInteger(baudRate, "Baud rate", 1, 4_000_000);
      resolvedTimeZone = validateTimeZone(timeZone);
    } catch (cause) {
      setIssue(errorMessage(cause, "The serial capture configuration is invalid."));
      return;
    }

    resetForStart("serial");
    const serialCapture = new WebSerialCapture(api);
    serialCaptureRef.current = serialCapture;
    serialDisconnectedRef.current = false;
    setSerialDevice("Waiting for operator selection");
    setSerialState("selecting");
    setPhase("starting");

    // Keep this call in the Start button's synchronous event path. WebSerialCapture
    // invokes navigator.serial.requestPort() before its first await so the browser's
    // transient user activation is retained for the device chooser.
    const startPromise = serialCapture.start({
      baudRate: parsedBaudRate,
      dataBits: Number(dataBits) as 7 | 8,
      stopBits: Number(stopBits) as 1 | 2,
      parity,
      flowControl,
    }, {
      onOpen: (device) => {
        if (startCancelledRef.current || !mountedRef.current) {
          throw new Error("Serial setup was cancelled before recording began.");
        }
        // WebSerialCapture invokes onOpen synchronously after port.open() and
        // before readLoop(), making this the exact serial capture epoch.
        const recorder = new CaptureRecorder({
          sessionId: serialSessionId,
          title,
          startedAt: new Date(),
          displayTimeZone: resolvedTimeZone,
          source: {
            id: `live-serial-${serialSessionId}`.slice(0, 128),
            kind: "serial",
            label: `${device.label} · ${parsedBaudRate.toLocaleString("en-US")} baud`.slice(0, 200),
          },
        });
        captureStartMsRef.current = nowMonotonicMs();
        lastDurationUsRef.current = 0;
        recorderRef.current = recorder;
        serialAssemblerRef.current = new Nsl01SerialFrameAssembler();
        setSerialDevice(device.label);
        setSerialState("open");
        setPhase("capturing");
      },
      onChunk: (bytes) => {
        if (transportRef.current !== "serial") return;
        const offsetUs = Math.max(0, Math.floor((nowMonotonicMs() - captureStartMsRef.current) * 1_000));
        if (!durationFrozenRef.current) lastDurationUsRef.current = Math.max(lastDurationUsRef.current, offsetUs + 1);
        observedSerialReadsRef.current += 1;
        observedSerialBytesRef.current += bytes.byteLength;
        if (captureInputClosedRef.current) return;
        if (ingestPausedRef.current) return;
        try {
          const assembler = serialAssemblerRef.current;
          if (!assembler) throw new Error("The serial frame assembler was not initialized before input arrived.");
          for (const assembly of assembler.push(bytes, offsetUs)) {
            appendCapturedBytes({ offsetUs: assembly.offsetUs, bytes: assembly.bytes });
          }
        } catch (cause) {
          pauseIngest(cause);
        }
      },
      onError: (error) => {
        freezeCaptureDuration();
        captureInputClosedRef.current = true;
        transportIntegrityIssueRef.current = error.message;
        setSerialState("error");
        setIssue(`${error.message} Stop and save the records retained before the serial error.`);
      },
      onDisconnect: () => {
        freezeCaptureDuration();
        captureInputClosedRef.current = true;
        transportIntegrityIssueRef.current = "The serial stream disconnected before the operator stopped it.";
        serialDisconnectedRef.current = true;
        setSerialState("disconnected");
        setIssue("The serial stream disconnected. Stop and save the records retained before the disconnect.");
      },
    });

    void startPromise.then((device) => {
      if (!mountedRef.current || transportRef.current !== "serial") return;
      setSerialDevice(device.label);
      if (!serialDisconnectedRef.current) setSerialState("open");
    }).catch((cause) => {
      const cancelled = startCancelledRef.current;
      clearRuntime();
      if (mountedRef.current) {
        setSerialState("error");
        setPhase("ready");
        if (cancelled) setNotice("Serial capture setup was cancelled before recording began.");
        else setIssue(errorMessage(cause, "The serial capture could not be started."));
      }
    });
  };

  const stopTransport = async (): Promise<number> => {
    const activeTransport = transportRef.current;
    let verifiedDurationUs = verifiedCaptureDurationUs({
      frozenDurationUs: frozenDurationUsRef.current,
      lastRetainedOffsetUs: lastRetainedOffsetUsRef.current,
    });
    if (activeTransport === "udp") {
      const client = udpClientRef.current;
      if (!client) throw new Error("The UDP bridge client is no longer available.");
      const ownedCaptureId = ownedUdpCaptureIdRef.current;
      if (!ownedCaptureId) {
        throw new UdpCaptureOwnershipError("This dialog does not own the active bridge capture, so it was not stopped.");
      }
      const status = await stopUdpCaptureIfOwned(client, ownedCaptureId);
      acceptUdpStatus(status);
      // The stop response can overtake already-written SSE datagrams on a
      // separate local connection. Wait only until its final counters arrive,
      // bounded to one second so a broken event stream cannot hang the dialog.
      if (status.capture) {
        const drainDeadlineMs = nowMonotonicMs() + 1_000;
        while (
          (observedUdpDatagramsRef.current < status.capture.datagrams
            || observedUdpBytesRef.current < status.capture.bytes)
          && nowMonotonicMs() < drainDeadlineMs
        ) {
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 20));
        }
      }
      captureInputClosedRef.current = true;
      verifiedDurationUs = verifiedCaptureDurationUs({
        frozenDurationUs: verifiedDurationUs,
        bridgeDurationUs: status.capture?.durationUs,
        bridgeDatagrams: status.capture?.datagrams,
        lastRetainedOffsetUs: lastRetainedOffsetUsRef.current,
      });
      verifiedStopDurationUsRef.current = verifiedDurationUs;
      client.disconnect();
      udpClientRef.current = null;
      transportRef.current = null;
      captureStartMsRef.current = 0;
      const recorder = recorderRef.current;
      assertUdpCaptureIntegrity(status, ownedCaptureId, {
        observedDatagrams: observedUdpDatagramsRef.current,
        observedBytes: observedUdpBytesRef.current,
        retainedRecords: recorder?.recordCount ?? 0,
        retainedBytes: recorder?.capturedBytes ?? 0,
        lastSequence: lastUdpSequenceRef.current,
        sequenceIssue: udpSequenceIssueRef.current,
      });
    } else if (activeTransport === "serial") {
      const serialCapture = serialCaptureRef.current;
      if (!serialCapture) throw new Error("The serial capture connection is no longer available.");
      await serialCapture.stop();
      captureInputClosedRef.current = true;
      serialCaptureRef.current = null;
      setSerialState("closed");
      const assembler = serialAssemblerRef.current;
      if (assembler && !ingestPausedRef.current) {
        for (const assembly of assembler.finish()) {
          appendCapturedBytes({ offsetUs: assembly.offsetUs, bytes: assembly.bytes });
        }
      }
      verifiedDurationUs = verifiedCaptureDurationUs({
        frozenDurationUs: verifiedDurationUs,
        lastRetainedOffsetUs: lastRetainedOffsetUsRef.current,
      });
      verifiedStopDurationUsRef.current = verifiedDurationUs;
      serialAssemblerRef.current = null;
      transportRef.current = null;
      captureStartMsRef.current = 0;
    } else {
      throw new Error("No active capture transport is available to stop.");
    }
    return verifiedDurationUs;
  };

  const deliverFinalizedSession = async (session: SessionDocument): Promise<void> => {
    pendingFinalizedSessionRef.current = session;
    setPhase("saving");
    let filename: string;
    try {
      filename = downloadSession(session);
    } catch (cause) {
      setPhase("save-error");
      setIssue(`${errorMessage(cause, "The session download could not be started.")} The finalized session remains in memory; retry the download or explicitly discard it.`);
      return;
    }

    pendingFinalizedSessionRef.current = null;
    try {
      await onComplete(session);
      if (mountedRef.current) {
        setNotice(`${filename} was downloaded and opened for replay.`);
        onClose();
      }
    } catch (cause) {
      if (mountedRef.current) {
        setPhase("ready");
        setIssue(`${errorMessage(cause, "The downloaded capture could not be opened automatically.")} The local .nlsession file is preserved.`);
      }
    }
  };

  const finalizeRetainedCapture = async (context: PendingFinalization): Promise<void> => {
    const recorder = recorderRef.current;
    pendingFinalizationRef.current = context;
    if (!recorder) {
      setPhase("finalize-error");
      setIssue("The retained capture recorder is unavailable. Explicitly discard this recovery state before closing.");
      return;
    }
    if (recorder.recordCount === 0) {
      setPhase("finalize-error");
      setIssue("The source stopped without producing a record, so there is no valid .nlsession to download. Explicitly discard this empty capture before closing or starting again.");
      return;
    }

    const boundedDuration = boundFinalizationDuration(context.durationUs, recorder.limits.maxDurationUs);
    let requestedDurationUs = boundedDuration.durationUs;
    let incompleteReason = context.incompleteReason;
    if (boundedDuration.wasCapped) {
      const durationReason = `Capture ran for ${formatDurationUs(context.durationUs, true)}, beyond the ${formatDurationUs(recorder.limits.maxDurationUs)} session limit; the retained replay duration was capped and marked incomplete.`;
      incompleteReason = incompleteReason ? `${incompleteReason}; ${durationReason}` : durationReason;
    }

    let finalized: SessionDocument;
    try {
      finalized = recorder.finalize(requestedDurationUs);
    } catch (cause) {
      pendingFinalizationRef.current = { durationUs: requestedDurationUs, incompleteReason };
      setPhase("finalize-error");
      setIssue(`${errorMessage(cause, "The retained capture could not be finalized.")} ${recorder.recordCount.toLocaleString()} retained records remain in memory; retry finalization or explicitly discard them.`);
      return;
    }

    const session = incompleteReason ? markCaptureRecoveryIncomplete(finalized) : finalized;
    pendingFinalizationRef.current = null;
    setTotals({
      inputUnits: transport === "udp" ? observedUdpDatagramsRef.current : observedSerialReadsRef.current,
      inputBytes: transport === "udp" ? observedUdpBytesRef.current : observedSerialBytesRef.current,
      records: session.records.length,
      recordedBytes: session.records.reduce((sum, record) => sum + record.captureBytes, 0),
    });
    recorderRef.current = null;
    serialAssemblerRef.current = null;
    if (incompleteReason) {
      setNotice(`Recovery capture is durably labeled incomplete: ${incompleteReason.slice(0, 800)}`);
    }
    await deliverFinalizedSession(session);
  };

  const stopAndSave = async (): Promise<void> => {
    if (phase !== "capturing" || finalizingRef.current) return;
    finalizingRef.current = true;
    const frozenDurationUs = freezeCaptureDuration();
    let finalDurationUs = frozenDurationUs;
    setPhase("stopping");
    setConfirmDiscard(false);
    setNotice("");
    let incompleteReason: string | null = transportIntegrityIssueRef.current;
    try {
      finalDurationUs = await stopTransport();
    } catch (cause) {
      const stopReason = errorMessage(cause, "The transport did not confirm a clean stop.");
      incompleteReason = incompleteReason ? `${incompleteReason}; ${stopReason}` : stopReason;
      captureInputClosedRef.current = true;
      udpClientRef.current?.disconnect();
      const serialCapture = serialCaptureRef.current;
      if (serialCapture) await serialCapture.stop().catch(() => undefined);
      const assembler = serialAssemblerRef.current;
      if (transportRef.current === "serial" && assembler && !ingestPausedRef.current) {
        try {
          for (const assembly of assembler.finish()) {
            appendCapturedBytes({ offsetUs: assembly.offsetUs, bytes: assembly.bytes });
          }
        } catch (assemblyCause) {
          incompleteReason += ` Serial tail recovery also failed: ${errorMessage(assemblyCause, "unknown assembly error")}`;
        }
      }
      transportRef.current = null;
      captureStartMsRef.current = 0;
      finalDurationUs = Math.max(
        finalDurationUs,
        verifiedStopDurationUsRef.current,
        lastRetainedOffsetUsRef.current + 1,
      );
    }

    try {
      setPhase("saving");
      await finalizeRetainedCapture({ durationUs: finalDurationUs, incompleteReason });
    } catch (cause) {
      if (mountedRef.current) {
        setPhase("finalize-error");
        setIssue(`${errorMessage(cause, "The retained capture could not be finalized.")} Retry finalization or explicitly discard the retained capture.`);
      }
    } finally {
      finalizingRef.current = false;
    }
  };

  const retryRetainedFinalization = async (): Promise<void> => {
    const context = pendingFinalizationRef.current;
    if (!context || finalizingRef.current) return;
    finalizingRef.current = true;
    setIssue("");
    setPhase("saving");
    try {
      await finalizeRetainedCapture(context);
    } finally {
      finalizingRef.current = false;
    }
  };

  const discardRetainedCapture = async (): Promise<void> => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setPhase("stopping");
    let shutdownWarning = "";
    const udpClient = udpClientRef.current;
    const ownedCaptureId = ownedUdpCaptureIdRef.current;
    if (udpClient && ownedCaptureId) {
      await stopUdpCaptureIfOwned(udpClient, ownedCaptureId).catch((cause) => {
        shutdownWarning = ` Transport shutdown remained unconfirmed: ${errorMessage(cause, "unknown stop failure")}`;
      });
      udpClient.disconnect();
    }
    const serialCapture = serialCaptureRef.current;
    if (serialCapture) {
      await serialCapture.stop().catch((cause) => {
        shutdownWarning = ` Transport shutdown remained unconfirmed: ${errorMessage(cause, "unknown stop failure")}`;
      });
    }
    pendingFinalizationRef.current = null;
    pendingFinalizedSessionRef.current = null;
    recorderRef.current = null;
    clearRuntime();
    setTotals(EMPTY_TOTALS);
    setIssue("");
    setPhase("ready");
    setNotice(`The retained capture was explicitly discarded.${shutdownWarning}`);
    finalizingRef.current = false;
  };

  const retryFinalizedDownload = async (): Promise<void> => {
    const session = pendingFinalizedSessionRef.current;
    if (!session || finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      await deliverFinalizedSession(session);
    } finally {
      finalizingRef.current = false;
    }
  };

  const discardCapture = async (): Promise<void> => {
    if (phase !== "capturing" || finalizingRef.current) return;
    finalizingRef.current = true;
    freezeCaptureDuration();
    captureInputClosedRef.current = true;
    setPhase("stopping");
    setNotice("");
    let stopFailure: unknown;
    try {
      await stopTransport();
    } catch (cause) {
      stopFailure = cause;
      // Explicit discard is the operator's escape hatch. A dead bridge or
      // device must not create an unrecoverable modal trap; disconnect local
      // control and make one final non-blocking close attempt.
      udpClientRef.current?.disconnect();
      const serialCapture = serialCaptureRef.current;
      if (serialCapture) void serialCapture.stop().catch(() => undefined);
    }
    clearRuntime();
    udpStatusRef.current = null;
    setUdpStatus(null);
    setTotals(EMPTY_TOTALS);
    setIssue("");
    setConfirmDiscard(false);
    setPhase("ready");
    try {
      if (stopFailure) {
        setNotice(`The local capture was discarded, but the transport did not confirm shutdown: ${errorMessage(stopFailure, "unknown stop failure")} Verify the bridge or device before starting another capture.`);
      } else {
        setNotice("The transport stopped and the local capture was discarded.");
      }
    } finally {
      finalizingRef.current = false;
    }
  };

  const cancelStartingCapture = (): void => {
    if (phase !== "starting") return;
    startCancelledRef.current = true;
    udpClientRef.current?.disconnect();
    setPhase("canceling");
    setNotice("Setup cancellation requested. Any late transport open will be closed without recording.");
  };

  const chooseTransport = (nextTransport: CaptureTransport): void => {
    if (captureLocked) return;
    setTransport(nextTransport);
    setIssue("");
    setNotice("");
  };

  const handleTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (captureLocked || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" || event.key === "ArrowLeft" ? "udp" : "serial";
    chooseTransport(next);
    requestAnimationFrame(() => (next === "udp" ? udpTabRef : serialTabRef).current?.focus());
  };

  const formSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (transport === "udp") void startUdpCapture();
  };

  const phaseLabel = capturePhaseLabel(phase, transport, issue);
  const unitLabel = transport === "udp" ? "Datagrams received" : "Serial reads received";
  const transportDetail = transport === "udp"
    ? udpStatus?.udp
      ? `${udpStatus.udp.host}:${udpStatus.udp.port}${udpStatus.udp.family ? ` · ${udpStatus.udp.family}` : ""}`
      : phase === "starting" ? "Negotiating local bind" : "Not bound"
    : serialDevice;

  return createPortal(
    <div
      className="dialog-backdrop capture-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!canDismiss) blockedClose();
        else onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="bundle-dialog capture-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${statusId}${issue ? ` ${errorId}` : ""}`}
      >
        <button
          className="dialog-close capture-dialog-close"
          type="button"
          aria-label={!canDismiss ? "Close unavailable while capture is active" : "Close live capture dialog"}
          aria-describedby={!canDismiss ? statusId : undefined}
          disabled={!canDismiss}
          onClick={onClose}
        >
          <X size={17} />
        </button>

        <span className="dialog-kicker">Local capture</span>
        <h2 id={titleId}>Record live telemetry</h2>
        <p id={descriptionId}>Capture exact UDP datagrams or NSL-01 serial frames locally, then open the immutable session in the replay workspace.</p>

        <form className="capture-dialog-form" onSubmit={formSubmit}>
          <div className="dialog-fields capture-session-fields">
            <label>
              <span>Session title</span>
              <input
                data-dialog-focus
                required
                maxLength={240}
                value={sessionTitle}
                disabled={captureLocked}
                onChange={(event) => setSessionTitle(event.target.value)}
              />
            </label>
            <label>
              <span>Display timezone</span>
              <input
                required
                maxLength={100}
                value={timeZone}
                disabled={captureLocked}
                onChange={(event) => setTimeZone(event.target.value)}
                spellCheck={false}
              />
              <small className="field-help">IANA name, such as America/Los_Angeles</small>
            </label>
          </div>

          <div className="capture-transport-tabs" role="tablist" aria-label="Capture transport">
            <button
              ref={udpTabRef}
              id={udpTabId}
              className={transport === "udp" ? "capture-transport-tab active" : "capture-transport-tab"}
              type="button"
              role="tab"
              aria-selected={transport === "udp"}
              aria-controls={udpPanelId}
              tabIndex={transport === "udp" ? 0 : -1}
              disabled={captureLocked}
              onKeyDown={handleTabKey}
              onClick={() => chooseTransport("udp")}
            >
              UDP bridge
            </button>
            <button
              ref={serialTabRef}
              id={serialTabId}
              className={transport === "serial" ? "capture-transport-tab active" : "capture-transport-tab"}
              type="button"
              role="tab"
              aria-selected={transport === "serial"}
              aria-controls={serialPanelId}
              tabIndex={transport === "serial" ? 0 : -1}
              disabled={captureLocked}
              onKeyDown={handleTabKey}
              onClick={() => chooseTransport("serial")}
            >
              Serial port
            </button>
          </div>

          <div
            id={udpPanelId}
            className="capture-transport-panel"
            role="tabpanel"
            aria-labelledby={udpTabId}
            hidden={transport !== "udp"}
          >
            <div className="dialog-fields capture-transport-fields">
              <label className="capture-field-wide">
                <span>Bridge URL</span>
                <input
                  type="url"
                  required={transport === "udp"}
                  value={bridgeUrl}
                  disabled={captureLocked}
                  onChange={(event) => setBridgeUrl(event.target.value)}
                  spellCheck={false}
                />
                <small className="field-help">Loopback HTTP origin only; telemetry is not sent to a remote service.</small>
              </label>
              <label className="capture-field-wide">
                <span>Bridge token</span>
                <input
                  type="password"
                  required={transport === "udp"}
                  minLength={16}
                  maxLength={256}
                  autoComplete="off"
                  value={bridgeToken}
                  disabled={captureLocked}
                  onChange={(event) => setBridgeToken(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>UDP bind host</span>
                <input
                  required={transport === "udp"}
                  maxLength={253}
                  value={udpHost}
                  disabled={captureLocked}
                  onChange={(event) => setUdpHost(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>UDP port</span>
                <input
                  type="number"
                  required={transport === "udp"}
                  min={0}
                  max={65_535}
                  step={1}
                  inputMode="numeric"
                  value={udpPort}
                  disabled={captureLocked}
                  onChange={(event) => setUdpPort(event.target.value)}
                />
                <small className="field-help">Use 0 to let the bridge choose an available local port.</small>
              </label>
              <label>
                <span>Multicast group (optional)</span>
                <input
                  maxLength={253}
                  value={multicastGroup}
                  disabled={captureLocked}
                  onChange={(event) => setMulticastGroup(event.target.value)}
                  placeholder="239.255.42.99"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>Multicast interface (optional)</span>
                <input
                  maxLength={253}
                  value={multicastInterface}
                  disabled={captureLocked}
                  onChange={(event) => setMulticastInterface(event.target.value)}
                  placeholder="127.0.0.1"
                  spellCheck={false}
                />
                <small className="field-help">Leave blank to use the operating system's default interface.</small>
              </label>
            </div>
          </div>

          <div
            id={serialPanelId}
            className="capture-transport-panel"
            role="tabpanel"
            aria-labelledby={serialTabId}
            hidden={transport !== "serial"}
          >
            <div className="dialog-fields capture-transport-fields">
              <label className="capture-field-wide">
                <span>Baud rate</span>
                <input
                  type="number"
                  required={transport === "serial"}
                  min={1}
                  max={4_000_000}
                  step={1}
                  inputMode="numeric"
                  value={baudRate}
                  disabled={captureLocked}
                  onChange={(event) => setBaudRate(event.target.value)}
                />
              </label>
              <label>
                <span>Data bits</span>
                <select value={dataBits} disabled={captureLocked} onChange={(event) => setDataBits(event.target.value as "7" | "8")}>
                  <option value="8">8</option>
                  <option value="7">7</option>
                </select>
              </label>
              <label>
                <span>Stop bits</span>
                <select value={stopBits} disabled={captureLocked} onChange={(event) => setStopBits(event.target.value as "1" | "2")}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
              <label>
                <span>Parity</span>
                <select value={parity} disabled={captureLocked} onChange={(event) => setParity(event.target.value as SerialParity)}>
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </label>
              <label>
                <span>Flow control</span>
                <select value={flowControl} disabled={captureLocked} onChange={(event) => setFlowControl(event.target.value as SerialFlowControl)}>
                  <option value="none">None</option>
                  <option value="hardware">Hardware</option>
                </select>
              </label>
            </div>
            {!serialAvailable && (
              <p className="capture-capability-warning" role="note">Web Serial is unavailable here. UDP capture remains available.</p>
            )}
          </div>

          <section className="capture-live-status" aria-labelledby={statusId}>
            <div className="capture-status-heading" role="status" aria-live="polite">
              <span id={statusId}>{phaseLabel}</span>
              {(phase === "starting" || phase === "stopping" || phase === "saving") && <SpinnerGap className="spin" size={16} aria-hidden="true" />}
            </div>
            <dl className="capture-status-grid">
              <div><dt>Source</dt><dd>{transportDetail}</dd></div>
              <div><dt>Elapsed</dt><dd>{formatDurationUs(elapsedUs, true)}</dd></div>
              <div><dt>{unitLabel}</dt><dd>{totals.inputUnits.toLocaleString()}</dd></div>
              <div><dt>Input bytes</dt><dd>{formatBytes(totals.inputBytes)}</dd></div>
              <div><dt>Records retained</dt><dd>{totals.records.toLocaleString()}</dd></div>
              <div><dt>Bytes retained</dt><dd>{formatBytes(totals.recordedBytes)}</dd></div>
            </dl>
            {transport === "udp" && udpStatus && (
              <p className="capture-transport-state">
                Bridge state: <strong>{udpStatus.state}</strong> · subscribers: {udpStatus.subscribers.toLocaleString()}
                {udpStatus.multicast ? ` · multicast ${udpStatus.multicast.group}${udpStatus.multicast.interface ? ` via ${udpStatus.multicast.interface}` : ""}` : ""}
              </p>
            )}
            {transport === "serial" && (
              <p className="capture-transport-state">Serial state: <strong>{serialState}</strong></p>
            )}
            {!canDismiss && <p className="capture-lock-notice">Closing is locked until the source is stopped and the capture is saved or explicitly discarded.</p>}
          </section>

          {issue && <p id={errorId} className="dialog-error capture-dialog-error" role="alert"><WarningCircle size={16} aria-hidden="true" /> {issue}</p>}
          {notice && <p className="capture-dialog-notice" role="status">{notice}</p>}

          {confirmDiscard && phase === "capturing" && (
            <div className="capture-discard-confirm" role="group" aria-label="Confirm capture discard">
              <p>This permanently removes the unsaved local recording after the transport stops.</p>
              <button ref={discardKeepRef} className="secondary-action" type="button" onClick={() => setConfirmDiscard(false)}>Keep recording</button>
              <button className="destructive-action" type="button" onClick={() => void discardCapture()}>Confirm discard</button>
            </div>
          )}

          <div className="dialog-actions capture-dialog-actions">
            {phase === "ready" ? (
              <>
                <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
                {transport === "udp" ? (
                  <button className="primary-action" type="submit">Start UDP capture</button>
                ) : (
                  <button
                    className="primary-action"
                    type="button"
                    disabled={!serialAvailable}
                    onClick={startSerialCapture}
                  >
                    Select port &amp; start
                  </button>
                )}
              </>
            ) : phase === "starting" ? (
              <button className="secondary-action" type="button" onClick={cancelStartingCapture}>Cancel setup</button>
            ) : phase === "canceling" ? (
              <button className="secondary-action" type="button" onClick={onClose}>Close</button>
            ) : phase === "capturing" ? (
              <>
                {!confirmDiscard && <button className="secondary-action" type="button" onClick={() => setConfirmDiscard(true)}>Discard</button>}
                <button className="primary-action" type="button" onClick={() => void stopAndSave()}>
                  <DownloadSimple size={16} aria-hidden="true" /> Stop, save &amp; replay
                </button>
              </>
            ) : phase === "save-error" ? (
              <>
                <button className="secondary-action" type="button" onClick={() => void discardRetainedCapture()}>Discard finalized session</button>
                <button className="primary-action" type="button" onClick={() => void retryFinalizedDownload()}>
                  <DownloadSimple size={16} aria-hidden="true" /> Retry download
                </button>
              </>
            ) : phase === "finalize-error" ? (
              <>
                <button className="secondary-action" type="button" onClick={() => void discardRetainedCapture()}>
                  Discard {recorderRef.current?.recordCount === 0 ? "empty" : "retained"} capture
                </button>
                {(recorderRef.current?.recordCount ?? 0) > 0 && (
                  <button className="primary-action" type="button" onClick={() => void retryRetainedFinalization()}>
                    Retry finalization
                  </button>
                )}
              </>
            ) : (
              <p className="capture-action-progress">{phaseLabel}…</p>
            )}
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

export default CaptureDialog;
