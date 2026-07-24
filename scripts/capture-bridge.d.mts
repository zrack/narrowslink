export interface CaptureBridgeOptions {
  controlPort?: number;
  udpHost?: string;
  udpPort?: number;
  multicastGroup?: string;
  multicastInterface?: string;
  token: string;
}

export interface CaptureBridgeStatus {
  protocolVersion: 1;
  state: "idle" | "starting" | "capturing" | "stopping" | "stopped" | "error";
  control: { host: "127.0.0.1"; port: number };
  defaults: {
    host: string;
    port: number;
    multicastGroup: string | null;
    multicastInterface: string | null;
  };
  udp: { host: string; port: number; family: "IPv4" | "IPv6" } | null;
  capture: {
    id: string;
    startedAt: string;
    endedAt?: string;
    datagrams: number;
    bytes: number;
    durationUs: number;
  } | null;
  captureJournal: {
    captureId: string;
    state: "active" | "clean" | "incomplete";
    entries: Array<{ type: string; code?: string }>;
  } | null;
}

export interface CaptureBridge {
  listen(): Promise<CaptureBridgeStatus>;
  close(options?: { code?: string; message?: string }): Promise<void>;
  status(): CaptureBridgeStatus;
  startCapture(input: unknown): Promise<unknown>;
  stopCapture(input: unknown): Promise<CaptureBridgeStatus>;
}

export function createCaptureBridge(options: CaptureBridgeOptions): CaptureBridge;
