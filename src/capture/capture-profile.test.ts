import { describe, expect, it } from "vitest";

import { NMEA0183_DECODER_PACK, NSL01_DECODER_PACK } from "../domain/decoder";
import {
  CAPTURE_PROFILE_STORAGE_KEY,
  CaptureProfileStorageError,
  clearCaptureProfiles,
  createCaptureProfile,
  loadCaptureProfiles,
  removeCaptureProfile,
  saveCaptureProfile,
  type CaptureProfileStorageLike,
} from "./capture-profile";

function memoryStorage(): CaptureProfileStorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("capture profiles", () => {
  it("round-trips an exact decoder pack and transport settings without secrets or payloads", () => {
    const storage = memoryStorage();
    const profile = createCaptureProfile({
      id: "profile-harbor-multicast",
      name: "Harbor multicast",
      decoderPack: NMEA0183_DECODER_PACK,
      settings: {
        transport: "udp",
        host: "0.0.0.0",
        port: 10_110,
        multicastGroup: "239.255.42.99",
        multicastInterface: "192.168.4.20",
      },
      createdAt: "2026-07-25T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
    });

    saveCaptureProfile(profile, storage);
    expect(loadCaptureProfiles(storage)).toEqual([profile]);
    const serialized = storage.values.get(CAPTURE_PROFILE_STORAGE_KEY) ?? "";
    expect(serialized).toContain(NMEA0183_DECODER_PACK.integrity.canonicalSha256);
    expect(serialized).not.toContain("bridgeToken");
    expect(serialized).not.toContain("sessionTitle");
    expect(serialized).not.toContain("payload");
  });

  it("updates by stable profile id, orders by recency, and removes explicitly", () => {
    const storage = memoryStorage();
    const first = createCaptureProfile({
      id: "profile-radio",
      name: "Surface radio",
      decoderPack: NSL01_DECODER_PACK,
      settings: {
        transport: "serial",
        baudRate: 57_600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      },
      createdAt: "2026-07-25T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
    });
    const second = createCaptureProfile({
      id: "profile-udp",
      name: "Bench UDP",
      decoderPack: NSL01_DECODER_PACK,
      settings: {
        transport: "udp",
        host: "127.0.0.1",
        port: 9_104,
        multicastGroup: null,
        multicastInterface: null,
      },
      createdAt: "2026-07-25T12:01:00.000Z",
      updatedAt: "2026-07-25T12:01:00.000Z",
    });

    saveCaptureProfile(first, storage);
    expect(saveCaptureProfile(second, storage).map((profile) => profile.id)).toEqual([
      "profile-udp",
      "profile-radio",
    ]);
    const updated = createCaptureProfile({
      ...first,
      name: "Surface radio 57k",
      updatedAt: "2026-07-25T12:02:00.000Z",
    });
    expect(saveCaptureProfile(updated, storage).map((profile) => profile.name)).toEqual([
      "Surface radio 57k",
      "Bench UDP",
    ]);
    expect(removeCaptureProfile("profile-radio", storage)).toEqual([second]);
    clearCaptureProfiles(storage);
    expect(loadCaptureProfiles(storage)).toEqual([]);
  });

  it("rejects altered decoder packs and corrupt stored collections", () => {
    const storage = memoryStorage();
    const alteredPack = structuredClone(NSL01_DECODER_PACK);
    alteredPack.displayName = "Altered";
    expect(() => createCaptureProfile({
      id: "profile-altered",
      name: "Altered",
      decoderPack: alteredPack,
      settings: {
        transport: "udp",
        host: "127.0.0.1",
        port: 9_104,
        multicastGroup: null,
        multicastInterface: null,
      },
    })).toThrow(CaptureProfileStorageError);

    storage.values.set(CAPTURE_PROFILE_STORAGE_KEY, "{\"format\":\"wrong\"}");
    expect(() => loadCaptureProfiles(storage)).toThrow(CaptureProfileStorageError);
  });

  it("leaves capture usable when local profile storage is unavailable", () => {
    expect(() => loadCaptureProfiles(null)).toThrowError(
      /Capture remains usable without saved profiles/,
    );
  });
});
