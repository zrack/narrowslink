import { createSocket } from "node:dgram";
import { setTimeout as delay } from "node:timers/promises";

interface FixtureRecord {
  readonly dataHex: string;
}

interface FixtureDocument {
  readonly records: readonly FixtureRecord[];
}

export interface SentDatagram {
  readonly dataHex: string;
  readonly byteLength: number;
}

function isFixtureDocument(value: unknown): value is FixtureDocument {
  if (typeof value !== "object" || value === null || !("records" in value)) return false;
  const records = value.records;
  return Array.isArray(records) && records.every((record) => (
    typeof record === "object"
    && record !== null
    && "dataHex" in record
    && typeof record.dataHex === "string"
    && /^(?:[0-9a-fA-F]{2})+$/.test(record.dataHex)
  ));
}

async function sendDatagram(
  socket: ReturnType<typeof createSocket>,
  bytes: Buffer,
  port: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.send(bytes, port, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function releaseFixtureDatagrams(
  appUrl: string,
  count: number,
): Promise<SentDatagram[]> {
  const response = await fetch(new URL("/fixtures/harbor-relay-session.json", appUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`The unpacked release fixture returned HTTP ${response.status}.`);
  }
  const document = await response.json() as unknown;
  if (!isFixtureDocument(document) || document.records.length < count) {
    throw new Error(`The unpacked release fixture does not contain ${count} valid records.`);
  }
  return document.records.slice(0, count).map((record) => ({
    dataHex: record.dataHex.toLowerCase(),
    byteLength: record.dataHex.length / 2,
  }));
}

export async function sendReleaseDatagrams(
  datagrams: readonly SentDatagram[],
  port: number,
  intervalMs = 10,
): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`The UI exposed an invalid UDP port: ${String(port)}`);
  }
  const socket = createSocket("udp4");
  try {
    for (const [index, datagram] of datagrams.entries()) {
      await sendDatagram(socket, Buffer.from(datagram.dataHex, "hex"), port);
      if (index + 1 < datagrams.length && intervalMs > 0) await delay(intervalMs);
    }
  } finally {
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
