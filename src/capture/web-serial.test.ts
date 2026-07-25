import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatSerialDevice,
  getBrowserSerialApi,
  WebSerialCapture,
  WebSerialCaptureError,
  type SerialOpenOptions,
  type WebSerialApi,
  type WebSerialPort,
} from "./web-serial";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakePort(chunks: Uint8Array[]): { port: WebSerialPort; openedWith: SerialOpenOptions[]; close: ReturnType<typeof vi.fn> } {
  const openedWith: SerialOpenOptions[] = [];
  const close = vi.fn(async () => undefined);
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    openedWith,
    close,
    port: {
      readable,
      async open(options) { openedWith.push(options); },
      close,
      getInfo: () => ({ usbVendorId: 0x123, usbProductId: 0xabcd }),
    },
  };
}

describe("WebSerialCapture", () => {
  it("requests, opens, streams, and closes a selected serial device", async () => {
    const source = fakePort([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const api: WebSerialApi = { requestPort: vi.fn(async () => source.port) };
    const chunks: number[][] = [];
    const lifecycle: string[] = [];
    const disconnected = vi.fn();
    const capture = new WebSerialCapture(api);

    const device = await capture.start({ baudRate: 115_200 }, {
      onOpen: (openedDevice) => {
        expect(openedDevice.label).toBe("Serial device · VID 0123 · PID ABCD");
        lifecycle.push("open");
      },
      onChunk: (bytes) => {
        lifecycle.push("chunk");
        chunks.push([...bytes]);
      },
      onDisconnect: disconnected,
    });
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    await capture.stop();

    expect(device.label).toBe("Serial device · VID 0123 · PID ABCD");
    expect(source.openedWith).toEqual([{
      baudRate: 115_200,
      bufferSize: 65_536,
      dataBits: 8,
      flowControl: "none",
      parity: "none",
      stopBits: 1,
    }]);
    expect(chunks).toEqual([[1, 2], [3]]);
    expect(lifecycle).toEqual(["open", "chunk", "chunk"]);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid options before requesting a port", async () => {
    const api: WebSerialApi = { requestPort: vi.fn() };
    const capture = new WebSerialCapture(api);

    await expect(capture.start({ baudRate: 0 }, { onChunk: () => undefined })).rejects.toThrow(WebSerialCaptureError);
    expect(api.requestPort).not.toHaveBeenCalled();
  });

  it("surfaces a denied device prompt as an actionable capture error", async () => {
    const api: WebSerialApi = { requestPort: vi.fn(async () => { throw new DOMException("Denied", "NotFoundError"); }) };
    const capture = new WebSerialCapture(api);

    await expect(capture.start({ baudRate: 9_600 }, { onChunk: () => undefined })).rejects.toThrow(
      "Serial device selection was cancelled or denied.",
    );
  });

  it("surfaces an open failure without leaving the capture active", async () => {
    const openFailure = new DOMException("Port is busy", "NetworkError");
    const close = vi.fn(async () => undefined);
    const port: WebSerialPort = {
      readable: null,
      open: vi.fn(async () => { throw openFailure; }),
      close,
      getInfo: () => ({}),
    };
    const capture = new WebSerialCapture({ requestPort: vi.fn(async () => port) });

    let thrown: unknown;
    try {
      await capture.start({ baudRate: 9_600 }, { onChunk: () => undefined });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WebSerialCaptureError);
    expect((thrown as Error).message).toBe("The selected serial device could not be opened.");
    expect((thrown as Error & { cause?: unknown }).cause).toBe(openFailure);
    expect(capture.active).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("reports a recoverable read error and continues with the replacement stream", async () => {
    const readFailure = new DOMException("Parity check failed", "ParityError");
    const recovered = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7, 8]));
        controller.close();
      },
    });
    let readable: ReadableStream<Uint8Array> | null;
    let failRead: (() => void) | undefined;
    const failed = new ReadableStream<Uint8Array>({
      pull(controller) {
        return new Promise<void>((resolve) => {
          failRead = () => {
            readable = recovered;
            controller.error(readFailure);
            resolve();
          };
        });
      },
    });
    readable = failed;
    const close = vi.fn(async () => undefined);
    const port: WebSerialPort = {
      get readable() { return readable; },
      open: vi.fn(async () => undefined),
      close,
      getInfo: () => ({}),
    };
    const errors: Error[] = [];
    const chunks: number[][] = [];
    const disconnected = vi.fn();
    const capture = new WebSerialCapture({ requestPort: vi.fn(async () => port) });

    await capture.start({ baudRate: 57_600 }, {
      onChunk: (bytes) => chunks.push([...bytes]),
      onError: (error) => errors.push(error),
      onDisconnect: disconnected,
    });
    await vi.waitFor(() => expect(failed.locked).toBe(true));
    if (!failRead) throw new Error("The failing serial stream was not pulled.");
    failRead();
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
    await capture.stop();

    expect(errors).toEqual([readFailure]);
    expect(chunks).toEqual([[7, 8]]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels the reader, releases its lock, and closes exactly once", async () => {
    const lifecycle: string[] = [];
    let readable: ReadableStream<Uint8Array>;
    readable = new ReadableStream<Uint8Array>({
      cancel() {
        lifecycle.push("cancel");
      },
    });
    const close = vi.fn(async () => {
      expect(readable.locked).toBe(false);
      lifecycle.push("close");
    });
    const port: WebSerialPort = {
      readable,
      open: vi.fn(async () => undefined),
      close,
      getInfo: () => ({}),
    };
    const capture = new WebSerialCapture({ requestPort: vi.fn(async () => port) });

    await capture.start({ baudRate: 115_200 }, { onChunk: () => undefined });
    await vi.waitFor(() => expect(readable.locked).toBe(true));
    await Promise.all([capture.stop(), capture.stop()]);
    await capture.stop();

    expect(lifecycle).toEqual(["cancel", "close"]);
    expect(close).toHaveBeenCalledOnce();
    expect(capture.active).toBe(false);
  });

  it("switches future chunks to new handlers without reopening the selected port", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const readable = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });
    const port: WebSerialPort = {
      readable,
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      getInfo: () => ({ usbVendorId: 0x1209 }),
    };
    const requestPort = vi.fn(async () => port);
    const preflight: number[][] = [];
    const recording: number[][] = [];
    const capture = new WebSerialCapture({ requestPort });

    await capture.start({ baudRate: 115_200 }, {
      onChunk: (bytes) => preflight.push([...bytes]),
    });
    controller?.enqueue(Uint8Array.from([1, 2]));
    await vi.waitFor(() => expect(preflight).toEqual([[1, 2]]));

    capture.replaceHandlers({
      onChunk: (bytes) => recording.push([...bytes]),
    });
    controller?.enqueue(Uint8Array.from([3, 4]));
    await vi.waitFor(() => expect(recording).toEqual([[3, 4]]));
    await capture.stop();

    expect(preflight).toEqual([[1, 2]]);
    expect(requestPort).toHaveBeenCalledOnce();
    expect(port.open).toHaveBeenCalledOnce();
  });

  it("rejects handler replacement when no serial port is open", () => {
    const capture = new WebSerialCapture({ requestPort: vi.fn() });
    expect(() => capture.replaceHandlers({ onChunk: () => undefined })).toThrow(
      "Serial handlers can only be replaced while the selected port is open.",
    );
  });
});

describe("getBrowserSerialApi", () => {
  it("detects support without assuming navigator exists", () => {
    vi.stubGlobal("navigator", undefined);
    expect(getBrowserSerialApi()).toBeNull();

    vi.stubGlobal("navigator", {});
    expect(getBrowserSerialApi()).toBeNull();

    const serial: WebSerialApi = { requestPort: vi.fn() };
    vi.stubGlobal("navigator", { serial });
    expect(getBrowserSerialApi()).toBe(serial);
  });
});

describe("formatSerialDevice", () => {
  it("provides stable labels without exposing browser-internal port paths", () => {
    expect(formatSerialDevice({})).toBe("Serial device");
    expect(formatSerialDevice({ bluetoothServiceClassId: "service-id" })).toBe("Bluetooth serial · service-id");
  });
});
