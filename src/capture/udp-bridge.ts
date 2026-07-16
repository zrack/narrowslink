export const UDP_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_UDP_BRIDGE_URL = "http://127.0.0.1:47891";
export const MAX_UDP_DATAGRAM_BYTES = 65_507;

const START_RECOVERY_MAX_AGE_MS = 25 * 60 * 60 * 1_000;
const START_RECOVERY_STORAGE_PREFIX = "narrowslink.udp-start-recovery.v1.";
const DEFINITIVE_START_FAILURE_CODES = new Set([
  "capture-active",
  "invalid-bind-host",
  "invalid-bind-port",
  "invalid-multicast-group",
  "invalid-request-nonce",
  "multicast-family-mismatch",
  "multicast-group-required",
  "multicast-membership-failed",
  "origin-not-allowed",
  "udp-bind-failed",
  "unauthorized",
  "unknown-field",
]);

interface StartRecoveryRecord {
  nonce: string;
  optionsKey: string;
  createdAtMs: number;
}

const inMemoryStartRecovery = new Map<string, StartRecoveryRecord>();

export type UdpBridgeState = "idle" | "starting" | "capturing" | "stopping" | "stopped" | "error";

export interface UdpBindAddress {
  host: string;
  port: number;
  family?: "IPv4" | "IPv6";
}

export interface UdpMulticastMembership {
  group: string;
  interface: string | null;
  family: "IPv4" | "IPv6";
}

export interface UdpCaptureProgress {
  id: string;
  startedAt: string;
  endedAt?: string;
  datagrams: number;
  bytes: number;
  durationUs: number;
  lastDatagramAt?: string;
}

export interface UdpBridgeErrorDetail {
  protocolVersion: typeof UDP_BRIDGE_PROTOCOL_VERSION;
  code: string;
  message: string;
  at: string;
  fatal: boolean;
}

export interface UdpBridgeStatus {
  protocolVersion: typeof UDP_BRIDGE_PROTOCOL_VERSION;
  state: UdpBridgeState;
  control: { host: "127.0.0.1"; port: number };
  defaults: {
    host: string;
    port: number;
    multicastGroup: string | null;
    multicastInterface: string | null;
  };
  udp: UdpBindAddress | null;
  multicast: UdpMulticastMembership | null;
  capture: UdpCaptureProgress | null;
  subscribers: number;
  lastError: UdpBridgeErrorDetail | null;
}

export interface UdpBridgeDatagram {
  protocolVersion: typeof UDP_BRIDGE_PROTOCOL_VERSION;
  captureId: string;
  sequence: number;
  offsetUs: number;
  receivedAt: string;
  remoteAddress: string;
  remotePort: number;
  remoteFamily: "IPv4" | "IPv6";
  byteLength: number;
  dataBase64: string;
  data: Uint8Array;
}

export interface UdpCaptureOptions {
  host: string;
  port: number;
  multicastGroup?: string;
  multicastInterface?: string;
}

export class UdpBridgeProtocolError extends Error {
  readonly code: string;

  constructor(message: string, code = "invalid-bridge-message") {
    super(message);
    this.name = "UdpBridgeProtocolError";
    this.code = code;
  }
}

interface BridgeEventSource {
  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void): void;
  close(): void;
}

export interface UdpBridgeClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  eventSourceFactory?: (url: string) => BridgeEventSource;
  connectTimeoutMs?: number;
  onStatus?: (status: UdpBridgeStatus) => void;
  onDatagram?: (datagram: UdpBridgeDatagram) => void;
  onError?: (error: UdpBridgeErrorDetail | UdpBridgeProtocolError) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maxLength = 512): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new UdpBridgeProtocolError(`Bridge field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, maxLength = 512): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new UdpBridgeProtocolError(`Bridge field ${key} must be a non-empty string when present.`);
  }
  return value;
}

function integer(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new UdpBridgeProtocolError(`Bridge field ${key} is outside its supported integer range.`);
  }
  return value;
}

function isoTimestamp(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key, 64);
  if (!Number.isFinite(Date.parse(value))) {
    throw new UdpBridgeProtocolError(`Bridge field ${key} is not an ISO timestamp.`);
  }
  return value;
}

function protocolVersion(record: Record<string, unknown>): void {
  if (record.protocolVersion !== UDP_BRIDGE_PROTOCOL_VERSION) {
    throw new UdpBridgeProtocolError("The local bridge uses an unsupported protocol version.", "unsupported-protocol");
  }
}

function parseErrorDetail(input: unknown): UdpBridgeErrorDetail {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The bridge error payload is malformed.");
  protocolVersion(input);
  if (typeof input.fatal !== "boolean") {
    throw new UdpBridgeProtocolError("Bridge field fatal must be a boolean.");
  }
  return {
    protocolVersion: UDP_BRIDGE_PROTOCOL_VERSION,
    code: requiredString(input, "code", 128),
    message: requiredString(input, "message", 1_000),
    at: isoTimestamp(input, "at"),
    fatal: input.fatal,
  };
}

function parseBindAddress(input: unknown): UdpBindAddress {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The UDP bind address is malformed.");
  const family = input.family;
  if (family !== undefined && family !== "IPv4" && family !== "IPv6") {
    throw new UdpBridgeProtocolError("Bridge field family must be IPv4 or IPv6.");
  }
  return {
    host: requiredString(input, "host", 253),
    port: integer(input, "port", 1, 65_535),
    ...(family === undefined ? {} : { family }),
  };
}

function parseMulticastMembership(input: unknown): UdpMulticastMembership {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The multicast membership payload is malformed.");
  const family = input.family;
  if (family !== "IPv4" && family !== "IPv6") {
    throw new UdpBridgeProtocolError("The multicast family must be IPv4 or IPv6.");
  }
  const interfaceAddress = input.interface;
  if (interfaceAddress !== null && (typeof interfaceAddress !== "string" || interfaceAddress.length === 0 || interfaceAddress.length > 253)) {
    throw new UdpBridgeProtocolError("The multicast interface must be an IP address or null.");
  }
  const group = requiredString(input, "group", 253);
  const groupFamily = ipFamily(group);
  const octets = groupFamily === 4 ? ipv4Octets(group) : null;
  const isMulticast = groupFamily === 4
    ? (octets?.[0] ?? 0) >= 224 && (octets?.[0] ?? 0) <= 239
    : groupFamily === 6 && group.toLowerCase().startsWith("ff");
  if (!isMulticast || (family === "IPv4" ? 4 : 6) !== groupFamily) {
    throw new UdpBridgeProtocolError("The reported multicast group does not match its IP family.");
  }
  if (interfaceAddress !== null && ipFamily(interfaceAddress) !== groupFamily) {
    throw new UdpBridgeProtocolError("The reported multicast interface does not match its group family.");
  }
  return {
    group,
    interface: interfaceAddress,
    family,
  };
}

function parseCaptureProgress(input: unknown): UdpCaptureProgress {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The capture progress payload is malformed.");
  const endedAt = optionalString(input, "endedAt", 64);
  const lastDatagramAt = optionalString(input, "lastDatagramAt", 64);
  if (endedAt && !Number.isFinite(Date.parse(endedAt))) {
    throw new UdpBridgeProtocolError("Bridge field endedAt is not an ISO timestamp.");
  }
  if (lastDatagramAt && !Number.isFinite(Date.parse(lastDatagramAt))) {
    throw new UdpBridgeProtocolError("Bridge field lastDatagramAt is not an ISO timestamp.");
  }
  return {
    id: requiredString(input, "id", 128),
    startedAt: isoTimestamp(input, "startedAt"),
    ...(endedAt ? { endedAt } : {}),
    datagrams: integer(input, "datagrams", 0, Number.MAX_SAFE_INTEGER),
    bytes: integer(input, "bytes", 0, Number.MAX_SAFE_INTEGER),
    durationUs: integer(input, "durationUs", 0, Number.MAX_SAFE_INTEGER),
    ...(lastDatagramAt ? { lastDatagramAt } : {}),
  };
}

export function parseUdpBridgeStatus(input: unknown): UdpBridgeStatus {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The bridge status payload is malformed.");
  protocolVersion(input);
  const states: readonly UdpBridgeState[] = ["idle", "starting", "capturing", "stopping", "stopped", "error"];
  if (!states.includes(input.state as UdpBridgeState)) {
    throw new UdpBridgeProtocolError("The bridge reported an unknown state.");
  }
  if (!isRecord(input.control) || input.control.host !== "127.0.0.1") {
    throw new UdpBridgeProtocolError("The bridge control plane is not bound to loopback.");
  }
  if (!isRecord(input.defaults)) throw new UdpBridgeProtocolError("The bridge defaults payload is malformed.");
  const udp = input.udp === null ? null : parseBindAddress(input.udp);
  const multicast = input.multicast == null ? null : parseMulticastMembership(input.multicast);
  const capture = input.capture === null ? null : parseCaptureProgress(input.capture);
  const lastError = input.lastError === null ? null : parseErrorDetail(input.lastError);
  return {
    protocolVersion: UDP_BRIDGE_PROTOCOL_VERSION,
    state: input.state as UdpBridgeState,
    control: {
      host: "127.0.0.1",
      port: integer(input.control, "port", 1, 65_535),
    },
    defaults: {
      host: requiredString(input.defaults, "host", 253),
      port: integer(input.defaults, "port", 0, 65_535),
      multicastGroup: input.defaults.multicastGroup == null
        ? null
        : requiredString(input.defaults, "multicastGroup", 253),
      multicastInterface: input.defaults.multicastInterface == null
        ? null
        : requiredString(input.defaults, "multicastInterface", 253),
    },
    udp,
    multicast,
    capture,
    subscribers: integer(input, "subscribers", 0, 10_000),
    lastError,
  };
}

export function decodeUdpDatagram(dataBase64: string, expectedLength: number): Uint8Array {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > MAX_UDP_DATAGRAM_BYTES) {
    throw new UdpBridgeProtocolError("The datagram byte length is outside the UDP payload limit.");
  }
  if (dataBase64.length > Math.ceil(MAX_UDP_DATAGRAM_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    throw new UdpBridgeProtocolError("The datagram payload is not valid base64.");
  }
  let binary: string;
  try {
    binary = globalThis.atob(dataBase64);
  } catch {
    throw new UdpBridgeProtocolError("The datagram payload is not valid base64.");
  }
  if (binary.length !== expectedLength) {
    throw new UdpBridgeProtocolError("The datagram byte length does not match its payload.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseUdpBridgeDatagram(input: unknown): UdpBridgeDatagram {
  if (!isRecord(input)) throw new UdpBridgeProtocolError("The bridge datagram payload is malformed.");
  protocolVersion(input);
  const remoteFamily = input.remoteFamily;
  if (remoteFamily !== "IPv4" && remoteFamily !== "IPv6") {
    throw new UdpBridgeProtocolError("The datagram remote family is invalid.");
  }
  const byteLength = integer(input, "byteLength", 0, MAX_UDP_DATAGRAM_BYTES);
  const dataBase64 = input.dataBase64;
  if (typeof dataBase64 !== "string" || dataBase64.length > Math.ceil(MAX_UDP_DATAGRAM_BYTES / 3) * 4) {
    throw new UdpBridgeProtocolError("Bridge field dataBase64 must contain a bounded base64 string.");
  }
  return {
    protocolVersion: UDP_BRIDGE_PROTOCOL_VERSION,
    captureId: requiredString(input, "captureId", 128),
    sequence: integer(input, "sequence", 0, Number.MAX_SAFE_INTEGER),
    offsetUs: integer(input, "offsetUs", 0, Number.MAX_SAFE_INTEGER),
    receivedAt: isoTimestamp(input, "receivedAt"),
    remoteAddress: requiredString(input, "remoteAddress", 253),
    remotePort: integer(input, "remotePort", 1, 65_535),
    remoteFamily,
    byteLength,
    dataBase64,
    data: decodeUdpDatagram(dataBase64, byteLength),
  };
}

function isAllowedLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function ipv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return parts.every((part, index) => /^(?:0|[1-9]\d{0,2})$/.test(part) && octets[index] !== undefined && octets[index] <= 255)
    ? octets
    : null;
}

function ipFamily(value: string): 4 | 6 | null {
  if (ipv4Octets(value)) return 4;
  const [address, zone, ...extra] = value.split("%");
  if (!address || extra.length > 0 || (zone !== undefined && !/^[A-Za-z0-9_.-]+$/.test(zone))) return null;
  if (!address.includes(":") || /[^0-9a-fA-F:.]/.test(address)) return null;
  try {
    const url = new URL(`http://[${address}]/`);
    return url.hostname.startsWith("[") && url.hostname.endsWith("]") ? 6 : null;
  } catch {
    return null;
  }
}

function validateMulticastOptions(options: UdpCaptureOptions): void {
  const group = options.multicastGroup;
  const interfaceAddress = options.multicastInterface;
  if (!group) {
    if (interfaceAddress !== undefined) {
      throw new UdpBridgeProtocolError("A multicast interface requires a multicast group.", "multicast-group-required");
    }
    return;
  }
  const family = ipFamily(group);
  const octets = family === 4 ? ipv4Octets(group) : null;
  const isMulticast = family === 4
    ? (octets?.[0] ?? 0) >= 224 && (octets?.[0] ?? 0) <= 239
    : family === 6 && group.toLowerCase().startsWith("ff");
  if (!isMulticast) {
    throw new UdpBridgeProtocolError("The multicast group must be an IPv4 or IPv6 multicast address.", "invalid-multicast-group");
  }
  if (interfaceAddress !== undefined && ipFamily(interfaceAddress) !== family) {
    throw new UdpBridgeProtocolError("The multicast interface must be an IP address in the same family as the group.", "multicast-family-mismatch");
  }
  const bindFamily = ipFamily(options.host);
  if (bindFamily !== null && bindFamily !== family) {
    throw new UdpBridgeProtocolError("The UDP bind host and multicast group must use the same IP family.", "multicast-family-mismatch");
  }
}

export function normalizeUdpBridgeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UdpBridgeProtocolError("The bridge URL is invalid.", "invalid-bridge-url");
  }
  if (url.protocol !== "http:" || !isAllowedLoopbackHost(url.hostname) || url.username || url.password) {
    throw new UdpBridgeProtocolError("The bridge URL must use HTTP on a loopback host.", "non-local-bridge-url");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new UdpBridgeProtocolError("The bridge URL must contain only its local origin.", "invalid-bridge-url");
  }
  return url.origin;
}

function validateToken(token: string): string {
  if (token.length < 16 || token.length > 256 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new UdpBridgeProtocolError("The bridge token is missing or invalid.", "invalid-token");
  }
  return token;
}

function recoveryFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}${value.length.toString(16)}`;
}

function recoveryStorageKey(baseUrl: string, token: string): string {
  return `${START_RECOVERY_STORAGE_PREFIX}${recoveryFingerprint(`${baseUrl}\u0000${token}`)}`;
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function validRecoveryRecord(value: unknown): value is StartRecoveryRecord {
  if (!isRecord(value)) return false;
  return typeof value.nonce === "string"
    && value.nonce.length >= 16
    && value.nonce.length <= 128
    && typeof value.optionsKey === "string"
    && value.optionsKey.length <= 1_024
    && typeof value.createdAtMs === "number"
    && Number.isSafeInteger(value.createdAtMs)
    && value.createdAtMs > 0
    && Date.now() - value.createdAtMs <= START_RECOVERY_MAX_AGE_MS;
}

function loadStartRecovery(storageKey: string): StartRecoveryRecord | null {
  const inMemory = inMemoryStartRecovery.get(storageKey);
  if (validRecoveryRecord(inMemory)) return inMemory;
  inMemoryStartRecovery.delete(storageKey);
  const storage = browserSessionStorage();
  if (!storage) return null;
  try {
    const encoded = storage.getItem(storageKey);
    if (!encoded) return null;
    const parsed = JSON.parse(encoded) as unknown;
    if (!validRecoveryRecord(parsed)) {
      storage.removeItem(storageKey);
      return null;
    }
    inMemoryStartRecovery.set(storageKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function saveStartRecovery(storageKey: string, record: StartRecoveryRecord): void {
  inMemoryStartRecovery.set(storageKey, record);
  try {
    browserSessionStorage()?.setItem(storageKey, JSON.stringify(record));
  } catch {
    // The in-memory record still makes retries safe for the current page.
  }
}

function clearStartRecovery(storageKey: string, expectedNonce: string): void {
  const current = loadStartRecovery(storageKey);
  if (current?.nonce !== expectedNonce) return;
  inMemoryStartRecovery.delete(storageKey);
  try {
    browserSessionStorage()?.removeItem(storageKey);
  } catch {
    // The in-memory capability has already been removed.
  }
}

function createRequestNonce(): string {
  const bytes = new Uint8Array(24);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    throw new UdpBridgeProtocolError("Secure randomness is unavailable for capture recovery.", "secure-random-unavailable");
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function captureOptionsKey(options: UdpCaptureOptions): string {
  return JSON.stringify({
    host: options.host,
    port: options.port,
    multicastGroup: options.multicastGroup ?? null,
    multicastInterface: options.multicastInterface ?? null,
  });
}

function parseMessageData(event: MessageEvent<string> | Event): unknown {
  if (!("data" in event) || typeof event.data !== "string") {
    throw new UdpBridgeProtocolError("The bridge event does not contain JSON data.");
  }
  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    throw new UdpBridgeProtocolError("The bridge event does not contain valid JSON.");
  }
}

export class UdpBridgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceFactory: (url: string) => BridgeEventSource;
  private readonly connectTimeoutMs: number;
  private readonly onStatus?: (status: UdpBridgeStatus) => void;
  private readonly onDatagram?: (datagram: UdpBridgeDatagram) => void;
  private readonly onError?: (error: UdpBridgeErrorDetail | UdpBridgeProtocolError) => void;
  private readonly startRecoveryStorageKey: string;
  private eventSource: BridgeEventSource | null = null;
  private connectPromise: Promise<UdpBridgeStatus> | null = null;
  private latestStatus: UdpBridgeStatus | null = null;
  private ownedCapture: { captureId: string; lease: string; requestNonce: string } | null = null;
  private startRecovery: StartRecoveryRecord | null = null;

  constructor(options: UdpBridgeClientOptions) {
    this.baseUrl = normalizeUdpBridgeUrl(options.baseUrl ?? DEFAULT_UDP_BRIDGE_URL);
    this.token = validateToken(options.token);
    this.startRecoveryStorageKey = recoveryStorageKey(this.baseUrl, this.token);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory = options.eventSourceFactory ?? ((url) => new EventSource(url) as BridgeEventSource);
    const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs < 100 || connectTimeoutMs > 60_000) {
      throw new UdpBridgeProtocolError("The bridge connection timeout must be between 100 and 60000 milliseconds.", "invalid-timeout");
    }
    this.connectTimeoutMs = connectTimeoutMs;
    this.onStatus = options.onStatus;
    this.onDatagram = options.onDatagram;
    this.onError = options.onError;
  }

  get status(): UdpBridgeStatus | null {
    return this.latestStatus;
  }

  async connect(): Promise<UdpBridgeStatus> {
    if (this.latestStatus && this.eventSource) return this.latestStatus;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<UdpBridgeStatus>((resolve, reject) => {
      const url = new URL("/v1/events", this.baseUrl);
      url.searchParams.set("token", this.token);
      const source = this.eventSourceFactory(url.toString());
      this.eventSource = source;
      let settled = false;
      const timeout = globalThis.setTimeout(() => {
        const error = new UdpBridgeProtocolError("The local capture bridge did not answer in time.", "connect-timeout");
        settled = true;
        this.disconnect();
        reject(error);
      }, this.connectTimeoutMs);

      const settleWithStatus = (status: UdpBridgeStatus) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(status);
      };
      const fail = (error: UdpBridgeProtocolError) => {
        this.onError?.(error);
        this.disconnect();
        if (!settled) {
          settled = true;
          globalThis.clearTimeout(timeout);
          reject(error);
        }
      };

      source.addEventListener("hello", (event) => {
        try {
          const status = parseUdpBridgeStatus(parseMessageData(event));
          this.acceptStatus(status);
          settleWithStatus(status);
        } catch (error) {
          fail(error instanceof UdpBridgeProtocolError ? error : new UdpBridgeProtocolError("Invalid bridge hello event."));
        }
      });
      source.addEventListener("status", (event) => {
        try {
          const status = parseUdpBridgeStatus(parseMessageData(event));
          this.acceptStatus(status);
          settleWithStatus(status);
        } catch (error) {
          fail(error instanceof UdpBridgeProtocolError ? error : new UdpBridgeProtocolError("Invalid bridge status event."));
        }
      });
      source.addEventListener("datagram", (event) => {
        try {
          this.onDatagram?.(parseUdpBridgeDatagram(parseMessageData(event)));
        } catch (error) {
          fail(error instanceof UdpBridgeProtocolError ? error : new UdpBridgeProtocolError("Invalid bridge datagram event."));
        }
      });
      source.addEventListener("bridge-error", (event) => {
        try {
          this.onError?.(parseErrorDetail(parseMessageData(event)));
        } catch (error) {
          fail(error instanceof UdpBridgeProtocolError ? error : new UdpBridgeProtocolError("Invalid bridge error event."));
        }
      });
      source.addEventListener("error", () => {
        const error = new UdpBridgeProtocolError("The local capture bridge event stream disconnected.", "event-stream-disconnected");
        this.onError?.(error);
        this.disconnect();
        if (!settled) {
          settled = true;
          globalThis.clearTimeout(timeout);
          reject(error);
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async getStatus(): Promise<UdpBridgeStatus> {
    const status = await this.requestStatus("/v1/status", { method: "GET" });
    const ownership = this.ownedCapture;
    if (ownership && status.state === "stopped" && ownership.captureId === status.capture?.id) {
      this.releaseOwnedCapture(ownership);
    }
    return status;
  }

  async start(options: UdpCaptureOptions): Promise<UdpBridgeStatus> {
    await this.connect();
    if (options.host.length === 0 || options.host.length > 253 || /[^A-Za-z0-9.:%_-]/.test(options.host)) {
      throw new UdpBridgeProtocolError("The UDP bind host is invalid.", "invalid-bind-host");
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
      throw new UdpBridgeProtocolError("The UDP bind port must be between 0 and 65535.", "invalid-bind-port");
    }
    validateMulticastOptions(options);
    const optionsKey = captureOptionsKey(options);
    let storedRecovery = this.startRecovery ?? loadStartRecovery(this.startRecoveryStorageKey);
    if (storedRecovery) {
      let refreshedStatus: UdpBridgeStatus | null = null;
      try {
        refreshedStatus = await this.requestStatus("/v1/status", { method: "GET" });
      } catch {
        // Ambiguous connectivity must preserve the only capability that can
        // recover a start whose response was lost.
      }
      if (refreshedStatus && ["idle", "stopped", "error"].includes(refreshedStatus.state)) {
        clearStartRecovery(this.startRecoveryStorageKey, storedRecovery.nonce);
        this.startRecovery = null;
        storedRecovery = null;
      }
    }
    if (storedRecovery && storedRecovery.optionsKey !== optionsKey) {
      throw new UdpBridgeProtocolError(
        "A previous start request may own an active capture. Retry with the same UDP settings before changing them.",
        "start-recovery-options-mismatch",
      );
    }
    const recovery = storedRecovery ?? {
      nonce: createRequestNonce(),
      optionsKey,
      createdAtMs: Date.now(),
    };
    this.startRecovery = recovery;
    saveStartRecovery(this.startRecoveryStorageKey, recovery);
    let payload: unknown;
    try {
      payload = await this.requestJson("/v1/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, requestNonce: recovery.nonce }),
      });
    } catch (error) {
      if (error instanceof UdpBridgeProtocolError && DEFINITIVE_START_FAILURE_CODES.has(error.code)) {
        clearStartRecovery(this.startRecoveryStorageKey, recovery.nonce);
        this.startRecovery = null;
      }
      throw error;
    }
    if (!isRecord(payload)) {
      throw new UdpBridgeProtocolError("The bridge start response is malformed.", "invalid-start-response");
    }
    protocolVersion(payload);
    const status = parseUdpBridgeStatus(payload.status);
    const lease = requiredString(payload, "lease", 256);
    if (lease.length < 16 || /[\u0000-\u001f\u007f]/.test(lease)) {
      throw new UdpBridgeProtocolError("The bridge start response did not include a valid ownership lease.", "invalid-start-response");
    }
    if (status.state !== "capturing" || !status.capture) {
      throw new UdpBridgeProtocolError("The bridge did not confirm an active owned capture.", "invalid-start-response");
    }
    this.ownedCapture = { captureId: status.capture.id, lease, requestNonce: recovery.nonce };
    this.acceptStatus(status);
    return status;
  }

  async stop(): Promise<UdpBridgeStatus> {
    const ownership = this.ownedCapture;
    if (!ownership) {
      throw new UdpBridgeProtocolError("This client does not own the active UDP capture.", "capture-not-owned");
    }
    const status = await this.requestStatus("/v1/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureId: ownership.captureId, lease: ownership.lease }),
    });
    if (status.capture?.id !== ownership.captureId || ["starting", "capturing", "stopping"].includes(status.state)) {
      throw new UdpBridgeProtocolError("The bridge returned an inconsistent stop response.", "invalid-stop-response");
    }
    this.releaseOwnedCapture(ownership);
    return status;
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
    this.latestStatus = null;
  }

  private acceptStatus(status: UdpBridgeStatus): void {
    this.latestStatus = status;
    this.onStatus?.(status);
  }

  private releaseOwnedCapture(ownership: { captureId: string; requestNonce: string }): void {
    if (this.ownedCapture?.captureId === ownership.captureId) this.ownedCapture = null;
    clearStartRecovery(this.startRecoveryStorageKey, ownership.requestNonce);
    if (this.startRecovery?.nonce === ownership.requestNonce) this.startRecovery = null;
  }

  private async requestStatus(path: string, init: RequestInit): Promise<UdpBridgeStatus> {
    const payload = await this.requestJson(path, init);
    const status = parseUdpBridgeStatus(payload);
    this.acceptStatus(status);
    return status;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.token}`);
      response = await this.fetchImpl(new URL(path, this.baseUrl), { ...init, headers });
    } catch (error) {
      throw new UdpBridgeProtocolError(
        error instanceof Error ? `Could not reach the local capture bridge: ${error.message}` : "Could not reach the local capture bridge.",
        "bridge-unreachable",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new UdpBridgeProtocolError("The local bridge returned a non-JSON response.", "invalid-http-response");
    }
    if (!response.ok) {
      if (isRecord(payload) && typeof payload.message === "string") {
        throw new UdpBridgeProtocolError(payload.message, typeof payload.code === "string" ? payload.code : "bridge-request-failed");
      }
      throw new UdpBridgeProtocolError(`The local bridge request failed with HTTP ${response.status}.`, "bridge-request-failed");
    }
    return payload;
  }
}
