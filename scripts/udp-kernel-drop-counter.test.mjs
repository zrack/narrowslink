import { describe, expect, it } from "vitest";

import {
  createUdpKernelDropCounter,
  parseLinuxUdpSocketTable,
} from "./udp-kernel-drop-counter.mjs";

function table(rows) {
  return [
    "  sl  local_address rem_address   st tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode ref pointer drops",
    ...rows,
    "",
  ].join("\n");
}

function row({ slot = 7, port = "238E", inode = "4242", drops = 0 } = {}) {
  return ` ${slot}: 0100007F:${port} 00000000:0000 07 00000000:00000000 00:00000000 00000000 501 0 ${inode} 2 0000000000000000 ${drops}`;
}

function fakeFileSystem(tables, links = { 10: "socket:[4242]", 11: "pipe:[9]" }) {
  let reads = 0;
  return {
    async readFile() {
      const value = tables[Math.min(reads, tables.length - 1)];
      reads += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    async readdir() {
      return Object.keys(links);
    },
    async readlink(path) {
      return links[path.split("/").at(-1)];
    },
  };
}

describe("UDP kernel drop counter", () => {
  it("parses bounded Linux UDP rows using a hexadecimal port and decimal drop counter", () => {
    expect(parseLinuxUdpSocketTable(table([
      row({ inode: "4242", drops: 10 }),
      "malformed",
    ]))).toEqual([{ inode: "4242", port: 9_102, drops: 10 }]);
  });

  it("reports the capture-socket drop delta between start and terminal samples", async () => {
    const counter = createUdpKernelDropCounter({
      platform: "linux",
      fileSystem: fakeFileSystem([
        table([row({ drops: 3 })]),
        table([row({ drops: 7 })]),
      ]),
    });

    await expect(counter.start({ family: "IPv4", port: 9_102 })).resolves.toEqual({
      kernelDroppedDatagrams: null,
      kernelDroppedDatagramsSource: "unavailable-capture-active",
    });
    await expect(counter.finish()).resolves.toEqual({
      kernelDroppedDatagrams: 4,
      kernelDroppedDatagramsSource: "linux-proc-net-udp-socket",
    });
  });

  it("keeps unsupported platforms unavailable instead of reporting zero", async () => {
    const counter = createUdpKernelDropCounter({ platform: "darwin", fileSystem: fakeFileSystem([]) });
    await expect(counter.start({ family: "IPv4", port: 9_102 })).resolves.toEqual({
      kernelDroppedDatagrams: null,
      kernelDroppedDatagramsSource: "unavailable-unsupported-platform",
    });
  });

  it("rejects an ambiguous process socket identity", async () => {
    const counter = createUdpKernelDropCounter({
      platform: "linux",
      fileSystem: fakeFileSystem([
        table([row(), row({ slot: 8, inode: "4343" })]),
      ], { 10: "socket:[4242]", 11: "socket:[4343]" }),
    });
    await expect(counter.start({ family: "IPv4", port: 9_102 })).resolves.toEqual({
      kernelDroppedDatagrams: null,
      kernelDroppedDatagramsSource: "unavailable-socket-identity",
    });
  });

  it("keeps missing procfs and counter regression explicit", async () => {
    const unavailable = createUdpKernelDropCounter({
      platform: "linux",
      fileSystem: fakeFileSystem([new Error("not mounted")]),
    });
    await expect(unavailable.start({ family: "IPv4", port: 9_102 })).resolves.toEqual({
      kernelDroppedDatagrams: null,
      kernelDroppedDatagramsSource: "unavailable-procfs",
    });

    const regressing = createUdpKernelDropCounter({
      platform: "linux",
      fileSystem: fakeFileSystem([
        table([row({ drops: 9 })]),
        table([row({ drops: 2 })]),
      ]),
    });
    await regressing.start({ family: "IPv4", port: 9_102 });
    await expect(regressing.finish()).resolves.toEqual({
      kernelDroppedDatagrams: null,
      kernelDroppedDatagramsSource: "unavailable-counter-regression",
    });
  });
});
