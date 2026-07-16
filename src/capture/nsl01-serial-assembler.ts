import { DECODER_SCHEMA } from "../domain/decoder";
import { MAX_CAPTURE_RECORD_BYTES } from "./recorder";

const SYNC_A = 0xa5;
const SYNC_B = 0x5a;
const HEADER_BYTES = 12;
const CHECKSUM_BYTES = 2;

/**
 * The live serial path is bound to the bundled, versioned NSL-01 schema. Keep
 * the assembly limit inside both that protocol schema and the session record
 * limit so an accidental sync word cannot reserve an arbitrary 16-bit frame.
 */
export const MAX_NSL01_SERIAL_PAYLOAD_BYTES = Math.min(
  Math.max(...Object.values(DECODER_SCHEMA.families).map((family) => family.payloadBytes)),
  MAX_CAPTURE_RECORD_BYTES - HEADER_BYTES - CHECKSUM_BYTES,
);
export const MAX_NSL01_SERIAL_FRAME_BYTES = HEADER_BYTES + MAX_NSL01_SERIAL_PAYLOAD_BYTES + CHECKSUM_BYTES;

export type SerialAssemblyKind = "frame" | "noise" | "partial";

export interface SerialAssembly {
  kind: SerialAssemblyKind;
  offsetUs: number;
  bytes: Uint8Array;
}

interface OffsetSpan {
  length: number;
  offsetUs: number;
}

export class SerialFrameAssemblerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerialFrameAssemblerError";
  }
}

/**
 * Reassembles NSL-01 frames from arbitrarily split serial reads. Bytes outside
 * frame boundaries and bytes left at end-of-stream are emitted instead of
 * discarded so the existing decoder can retain them as diagnostics.
 */
export class Nsl01SerialFrameAssembler {
  private buffer: number[] = [];
  private head = 0;
  private readonly spans: OffsetSpan[] = [];
  private lastChunkOffsetUs = -1;
  private finished = false;

  get bufferedBytes(): number {
    return this.buffer.length - this.head;
  }

  push(chunk: Uint8Array, offsetUs: number): SerialAssembly[] {
    if (this.finished) {
      throw new SerialFrameAssemblerError("Serial stream has already finished; create a new assembler for another capture.");
    }
    if (!Number.isSafeInteger(offsetUs) || offsetUs < 0) {
      throw new SerialFrameAssemblerError("Serial chunk offsets must be non-negative integer microseconds.");
    }
    if (offsetUs < this.lastChunkOffsetUs) {
      throw new SerialFrameAssemblerError(
        `Serial chunk offsets must be monotonic; received ${offsetUs}µs after ${this.lastChunkOffsetUs}µs.`,
      );
    }
    if (!(chunk instanceof Uint8Array)) {
      throw new SerialFrameAssemblerError("Serial chunks must be Uint8Array instances.");
    }

    this.lastChunkOffsetUs = offsetUs;
    const records: SerialAssembly[] = [];
    for (let start = 0; start < chunk.byteLength; start += MAX_CAPTURE_RECORD_BYTES) {
      const part = chunk.subarray(start, Math.min(chunk.byteLength, start + MAX_CAPTURE_RECORD_BYTES));
      for (const byte of part) this.buffer.push(byte);
      const lastSpan = this.spans.at(-1);
      if (lastSpan?.offsetUs === offsetUs) lastSpan.length += part.byteLength;
      else this.spans.push({ length: part.byteLength, offsetUs });
      records.push(...this.drainCompleteRecords());
    }
    return records;
  }

  finish(): SerialAssembly[] {
    if (this.finished) {
      throw new SerialFrameAssemblerError("Serial stream has already finished.");
    }
    const records = this.drainCompleteRecords();
    if (this.bufferedBytes > 0) {
      const kind = this.startsWithSync() || this.byteAt(0) === SYNC_A ? "partial" : "noise";
      records.push(...this.consumeBounded(this.bufferedBytes, kind));
    }
    this.finished = true;
    return records;
  }

  private byteAt(index: number): number | undefined {
    return this.buffer[this.head + index];
  }

  private startsWithSync(): boolean {
    return this.byteAt(0) === SYNC_A && this.byteAt(1) === SYNC_B;
  }

  private findSync(startIndex = 0): number {
    for (let index = startIndex; index + 1 < this.bufferedBytes; index += 1) {
      if (this.byteAt(index) === SYNC_A && this.byteAt(index + 1) === SYNC_B) return index;
    }
    return -1;
  }

  private drainCompleteRecords(): SerialAssembly[] {
    const records: SerialAssembly[] = [];
    while (this.bufferedBytes > 0) {
      const syncIndex = this.findSync();
      if (syncIndex < 0) {
        const retainedBytes = this.byteAt(this.bufferedBytes - 1) === SYNC_A ? 1 : 0;
        const noiseBytes = this.bufferedBytes - retainedBytes;
        if (noiseBytes > 0) records.push(...this.consumeBounded(noiseBytes, "noise"));
        break;
      }
      if (syncIndex > 0) {
        records.push(...this.consumeBounded(syncIndex, "noise"));
        continue;
      }
      if (this.bufferedBytes < HEADER_BYTES) break;

      const payloadLength = (this.byteAt(6) ?? 0) | ((this.byteAt(7) ?? 0) << 8);
      const frameBytes = HEADER_BYTES + payloadLength + CHECKSUM_BYTES;
      if (frameBytes > MAX_NSL01_SERIAL_FRAME_BYTES) {
        // This sync word cannot begin a frame supported by the active decoder
        // schema. Retain the bytes as noise and move directly to the next sync
        // candidate instead of waiting for an attacker-controlled 16-bit size.
        const nextSync = this.findSync(1);
        const retainedBytes = nextSync < 0 && this.byteAt(this.bufferedBytes - 1) === SYNC_A ? 1 : 0;
        const noiseBytes = nextSync < 0 ? this.bufferedBytes - retainedBytes : nextSync;
        if (noiseBytes > 0) records.push(...this.consumeBounded(noiseBytes, "noise"));
        if (nextSync < 0) break;
        continue;
      }
      if (this.bufferedBytes < frameBytes) break;
      records.push(this.consume(frameBytes, "frame"));
    }
    return records;
  }

  private consumeBounded(count: number, kind: Exclude<SerialAssemblyKind, "frame">): SerialAssembly[] {
    const records: SerialAssembly[] = [];
    let remaining = count;
    while (remaining > 0) {
      const nextCount = Math.min(remaining, MAX_CAPTURE_RECORD_BYTES);
      records.push(this.consume(nextCount, kind));
      remaining -= nextCount;
    }
    return records;
  }

  private consume(count: number, kind: SerialAssemblyKind): SerialAssembly {
    const firstSpan = this.spans[0];
    if (!firstSpan || count <= 0 || count > this.bufferedBytes) {
      throw new SerialFrameAssemblerError("Internal serial assembly boundary is inconsistent.");
    }

    const bytes = Uint8Array.from(this.buffer.slice(this.head, this.head + count));
    const offsetUs = firstSpan.offsetUs;
    this.head += count;

    let remaining = count;
    while (remaining > 0) {
      const span = this.spans[0];
      if (!span) throw new SerialFrameAssemblerError("Internal serial timestamp span is missing.");
      if (remaining < span.length) {
        span.length -= remaining;
        remaining = 0;
      } else {
        remaining -= span.length;
        this.spans.shift();
      }
    }

    if (this.head >= 8_192 && this.head * 2 >= this.buffer.length) {
      this.buffer = this.buffer.slice(this.head);
      this.head = 0;
    }
    if (this.head === this.buffer.length) {
      this.buffer = [];
      this.head = 0;
    }

    return { kind, offsetUs, bytes };
  }
}
