import { readdir, readFile, readlink } from "node:fs/promises";

export const UDP_KERNEL_DROP_COUNTER_SOURCES = Object.freeze([
  "linux-proc-net-udp-socket",
  "unavailable",
  "unavailable-capture-active",
  "unavailable-unsupported-platform",
  "unavailable-procfs",
  "unavailable-socket-identity",
  "unavailable-counter-regression",
]);

const SOCKET_LINK_PATTERN = /^socket:\[(\d+)\]$/;

function unavailable(source) {
  return Object.freeze({
    kernelDroppedDatagrams: null,
    kernelDroppedDatagramsSource: source,
  });
}

function measured(value) {
  return Object.freeze({
    kernelDroppedDatagrams: value,
    kernelDroppedDatagramsSource: "linux-proc-net-udp-socket",
  });
}

export function parseLinuxUdpSocketTable(contents) {
  if (typeof contents !== "string") return [];
  const rows = [];
  for (const line of contents.split(/\r?\n/u).slice(1)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 10) continue;
    const localAddress = fields[1];
    const inode = fields[9];
    const dropsHex = fields.at(-1);
    const separator = localAddress?.lastIndexOf(":") ?? -1;
    if (
      separator < 0
      || !/^\d+$/u.test(inode ?? "")
      || !/^[0-9A-Fa-f]+$/u.test(localAddress?.slice(separator + 1) ?? "")
      || !/^\d+$/u.test(dropsHex ?? "")
    ) {
      continue;
    }
    const port = Number.parseInt(localAddress.slice(separator + 1), 16);
    const drops = Number.parseInt(dropsHex, 10);
    if (!Number.isSafeInteger(port) || !Number.isSafeInteger(drops)) continue;
    rows.push(Object.freeze({ inode, port, drops }));
  }
  return rows;
}

async function processSocketInodes(fileSystem, procRoot) {
  const directory = `${procRoot}/self/fd`;
  const entries = await fileSystem.readdir(directory);
  const links = await Promise.all(entries.map(async (entry) => {
    try {
      return await fileSystem.readlink(`${directory}/${entry}`);
    } catch {
      return null;
    }
  }));
  return new Set(links.flatMap((link) => {
    const match = typeof link === "string" ? SOCKET_LINK_PATTERN.exec(link) : null;
    return match?.[1] ? [match[1]] : [];
  }));
}

function procTablePath(procRoot, family) {
  return `${procRoot}/self/net/${family === "IPv6" ? "udp6" : "udp"}`;
}

export function createUdpKernelDropCounter(options = {}) {
  const platform = options.platform ?? process.platform;
  const procRoot = options.procRoot ?? "/proc";
  const fileSystem = options.fileSystem ?? { readdir, readFile, readlink };
  let initial = null;
  let result = unavailable(platform === "linux"
    ? "unavailable-socket-identity"
    : "unavailable-unsupported-platform");

  return Object.freeze({
    async start(endpoint) {
      if (platform !== "linux") return result;
      try {
        const tablePath = procTablePath(procRoot, endpoint.family);
        const [contents, socketInodes] = await Promise.all([
          fileSystem.readFile(tablePath, "utf8"),
          processSocketInodes(fileSystem, procRoot),
        ]);
        const matches = parseLinuxUdpSocketTable(contents).filter((row) => (
          row.port === endpoint.port && socketInodes.has(row.inode)
        ));
        if (matches.length !== 1) {
          result = unavailable("unavailable-socket-identity");
          return result;
        }
        initial = Object.freeze({
          tablePath,
          inode: matches[0].inode,
          drops: matches[0].drops,
        });
        result = unavailable("unavailable-capture-active");
        return result;
      } catch {
        result = unavailable("unavailable-procfs");
        return result;
      }
    },

    async finish() {
      if (!initial) return result;
      try {
        const contents = await fileSystem.readFile(initial.tablePath, "utf8");
        const terminal = parseLinuxUdpSocketTable(contents).find((row) => row.inode === initial.inode);
        if (!terminal) {
          result = unavailable("unavailable-socket-identity");
        } else if (terminal.drops < initial.drops) {
          result = unavailable("unavailable-counter-regression");
        } else {
          result = measured(terminal.drops - initial.drops);
        }
      } catch {
        result = unavailable("unavailable-procfs");
      }
      return result;
    },

    current() {
      return result;
    },
  });
}
