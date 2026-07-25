import { MAX_CAPTURE_RECORD_BYTES } from "./recorder";
import {
  SerialFrameAssemblerError,
  type SerialAssembly,
  type SerialRecordAssembler,
} from "./nsl01-serial-assembler";

interface OffsetSpan {
  length: number;
  offsetUs: number;
}

/**
 * Retains LF-delimited NMEA sentences as records. Overlong unterminated input
 * is emitted in bounded partial records so malformed bytes remain inspectable.
 */
export class Nmea0183SerialLineAssembler implements SerialRecordAssembler {
  private buffer: number[] = [];
  private head = 0;
  private readonly spans: OffsetSpan[] = [];
  private lastChunkOffsetUs = -1;
  private finished = false;

  constructor(private readonly maxRecordBytes: number) {
    if (
      !Number.isSafeInteger(maxRecordBytes)
      || maxRecordBytes <= 0
      || maxRecordBytes > MAX_CAPTURE_RECORD_BYTES
    ) {
      throw new SerialFrameAssemblerError("NMEA serial record limit is invalid.");
    }
  }

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
    for (const byte of chunk) this.buffer.push(byte);
    const lastSpan = this.spans.at(-1);
    if (lastSpan?.offsetUs === offsetUs) lastSpan.length += chunk.byteLength;
    else if (chunk.byteLength > 0) this.spans.push({ length: chunk.byteLength, offsetUs });
    return this.drain();
  }

  finish(): SerialAssembly[] {
    if (this.finished) throw new SerialFrameAssemblerError("Serial stream has already finished.");
    const records = this.drain();
    while (this.bufferedBytes > 0) {
      records.push(this.consume(Math.min(this.bufferedBytes, this.maxRecordBytes), "partial"));
    }
    this.finished = true;
    return records;
  }

  private drain(): SerialAssembly[] {
    const records: SerialAssembly[] = [];
    while (this.bufferedBytes > 0) {
      const newlineIndex = this.findLineFeed();
      if (newlineIndex >= 0) {
        const lineBytes = newlineIndex + 1;
        if (lineBytes <= this.maxRecordBytes) {
          records.push(this.consume(lineBytes, "frame"));
        } else {
          records.push(this.consume(this.maxRecordBytes, "partial"));
        }
        continue;
      }
      if (this.bufferedBytes > this.maxRecordBytes) {
        records.push(this.consume(this.maxRecordBytes, "partial"));
        continue;
      }
      break;
    }
    return records;
  }

  private findLineFeed(): number {
    for (let index = 0; index < this.bufferedBytes; index += 1) {
      if (this.buffer[this.head + index] === 0x0a) return index;
    }
    return -1;
  }

  private consume(count: number, kind: SerialAssembly["kind"]): SerialAssembly {
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
