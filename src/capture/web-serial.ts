export type SerialParity = "none" | "even" | "odd";
export type SerialFlowControl = "none" | "hardware";

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
}

export interface SerialOpenOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: SerialParity;
  bufferSize?: number;
  flowControl?: SerialFlowControl;
}

export interface WebSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  open(options: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

export interface WebSerialApi {
  requestPort(): Promise<WebSerialPort>;
}

export interface SerialCaptureHandlers {
  /** Runs after the port opens and before the first onChunk callback. */
  onOpen?: (device: SerialCaptureDevice) => void;
  onChunk: (bytes: Uint8Array) => void;
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
}

export interface SerialCaptureDevice {
  label: string;
  info: SerialPortInfo;
}

interface NavigatorWithSerial extends Navigator {
  serial?: WebSerialApi;
}

const MAX_SERIAL_BUFFER_BYTES = 16 * 1024 * 1024 - 1;

export class WebSerialCaptureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebSerialCaptureError";
  }
}

export function getBrowserSerialApi(): WebSerialApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as NavigatorWithSerial).serial ?? null;
}

export function formatSerialDevice(info: SerialPortInfo): string {
  const vendor = info.usbVendorId == null ? null : `VID ${info.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}`;
  const product = info.usbProductId == null ? null : `PID ${info.usbProductId.toString(16).toUpperCase().padStart(4, "0")}`;
  const usbIdentity = [vendor, product].filter(Boolean).join(" · ");
  if (usbIdentity) return `Serial device · ${usbIdentity}`;
  if (info.bluetoothServiceClassId) return `Bluetooth serial · ${info.bluetoothServiceClassId}`;
  return "Serial device";
}

function validateOptions(options: SerialOpenOptions): SerialOpenOptions {
  if (!Number.isSafeInteger(options.baudRate) || options.baudRate <= 0) {
    throw new WebSerialCaptureError("Baud rate must be a positive integer.");
  }
  if (options.bufferSize != null && (!Number.isSafeInteger(options.bufferSize) || options.bufferSize < 1 || options.bufferSize > MAX_SERIAL_BUFFER_BYTES)) {
    throw new WebSerialCaptureError(`Serial buffer size must be between 1 and ${MAX_SERIAL_BUFFER_BYTES.toLocaleString()} bytes.`);
  }
  return {
    baudRate: options.baudRate,
    dataBits: options.dataBits ?? 8,
    stopBits: options.stopBits ?? 1,
    parity: options.parity ?? "none",
    bufferSize: options.bufferSize ?? 65_536,
    flowControl: options.flowControl ?? "none",
  };
}

function asError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

export class WebSerialCapture {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private stopTask: Promise<void> | null = null;
  private handlers: SerialCaptureHandlers | null = null;
  private starting = false;
  private stopRequested = false;

  constructor(private readonly api: WebSerialApi) {}

  get active(): boolean {
    return this.port != null && !this.stopRequested;
  }

  /**
   * Changes where future serial reads are delivered without reopening the
   * operator-selected device. JavaScript callback execution is serialized, so
   * this creates an exact boundary between the final old-handler chunk and the
   * first new-handler chunk.
   */
  replaceHandlers(handlers: SerialCaptureHandlers): void {
    if (!this.active) {
      throw new WebSerialCaptureError("Serial handlers can only be replaced while the selected port is open.");
    }
    this.handlers = handlers;
  }

  async start(options: SerialOpenOptions, handlers: SerialCaptureHandlers): Promise<SerialCaptureDevice> {
    if (this.port || this.starting) throw new WebSerialCaptureError("A serial capture is already active.");
    const validated = validateOptions(options);
    this.stopRequested = false;
    this.starting = true;

    try {
      let port: WebSerialPort;
      try {
        // requestPort must remain the first awaited operation so callers can invoke
        // start directly from a user gesture and retain transient activation.
        port = await this.api.requestPort();
      } catch (cause) {
        throw new WebSerialCaptureError("Serial device selection was cancelled or denied.", { cause });
      }

      try {
        await port.open(validated);
      } catch (cause) {
        throw new WebSerialCaptureError("The selected serial device could not be opened.", { cause });
      }

      this.port = port;
      try {
        const info = port.getInfo();
        const device = { label: formatSerialDevice(info), info };
        handlers.onOpen?.(device);
        this.handlers = handlers;
        this.readTask = this.readLoop(port);
        return device;
      } catch (cause) {
        this.stopRequested = true;
        try {
          await port.close();
        } catch (closeCause) {
          throw new WebSerialCaptureError("Serial capture setup failed and the device did not close cleanly.", {
            cause: new AggregateError([asError(cause, "Serial capture setup failed."), asError(closeCause, "Serial close failed.")]),
          });
        } finally {
          this.port = null;
          this.reader = null;
          this.readTask = null;
          this.handlers = null;
        }
        throw new WebSerialCaptureError("Serial capture setup failed before reading began.", { cause });
      }
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    const port = this.port;
    if (!port) return;
    this.stopRequested = true;

    const stopTask = this.stopPort(port);
    this.stopTask = stopTask;
    try {
      await stopTask;
    } finally {
      if (this.stopTask === stopTask) this.stopTask = null;
    }
  }

  private async stopPort(port: WebSerialPort): Promise<void> {
    let readFailure: unknown;
    try {
      await this.reader?.cancel();
    } catch {
      // A disconnect may have already invalidated the reader. The read task
      // owns surfacing transport errors and releasing its lock.
    }
    try {
      await this.readTask;
    } catch (cause) {
      readFailure = cause;
    }

    let closeFailure: unknown;
    try {
      await port.close();
    } catch (cause) {
      closeFailure = cause;
    } finally {
      if (this.port === port) {
        this.readTask = null;
        this.reader = null;
        this.port = null;
        this.handlers = null;
      }
    }

    if (closeFailure) throw new WebSerialCaptureError("The serial device did not close cleanly.", { cause: closeFailure });
    if (readFailure) throw new WebSerialCaptureError("The serial read loop did not stop cleanly.", { cause: readFailure });
  }

  private async readLoop(port: WebSerialPort): Promise<void> {
    while (!this.stopRequested && port.readable) {
      const reader = port.readable.getReader();
      let streamEnded = false;
      this.reader = reader;
      try {
        while (!this.stopRequested) {
          const { value, done } = await reader.read();
          if (done) {
            streamEnded = true;
            break;
          }
          if (value && value.byteLength > 0) this.handlers?.onChunk(new Uint8Array(value));
        }
      } catch (cause) {
        if (!this.stopRequested) this.handlers?.onError?.(asError(cause, "Serial read failed."));
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
      if (streamEnded) break;
    }
    if (!this.stopRequested) {
      this.stopRequested = true;
      this.handlers?.onDisconnect?.();
    }
  }
}
