import { describe, expect, it } from "vitest";

import {
  NMEA0183_DECODER_PACK,
  NSL01_DECODER_PACK,
  resolveDecoderPack,
} from "./decoder";
import { verifyDecoderPackConformance } from "./decoder-conformance";
import {
  DecoderPackValidationError,
  decoderDescriptorForPack,
  parseBoundedDecoderPackJson,
  sealDecoderPack,
  serializeDecoderPack,
  validateDecoderPack,
} from "./decoder-pack";

describe("decoder packs", () => {
  it.each([
    ["NSL-01", NSL01_DECODER_PACK],
    ["NMEA 0183", NMEA0183_DECODER_PACK],
  ])("passes bundled %s conformance fixtures", (_name, pack) => {
    const result = verifyDecoderPackConformance(pack);

    expect(result.pack.integrity.canonicalSha256).toBe(pack.integrity.canonicalSha256);
    expect(result.fixtureIds).toEqual(pack.fixtures.map((fixture) => fixture.id));
    expect(result.frameCount).toBe(pack.fixtures.reduce((total, fixture) => total + fixture.records.length, 0));
  });

  it("rejects altered canonical pack content before execution", () => {
    const altered = JSON.parse(serializeDecoderPack(NMEA0183_DECODER_PACK)) as Record<string, unknown>;
    altered.description = "Altered after the pack was sealed";

    expect(() => validateDecoderPack(altered)).toThrow(DecoderPackValidationError);
    expect(() => validateDecoderPack(altered)).toThrow("does not match its declared identity");
  });

  it("binds a descriptor to pack, schema, and runtime identities", () => {
    const descriptor = decoderDescriptorForPack(NMEA0183_DECODER_PACK);

    expect(resolveDecoderPack(descriptor, NMEA0183_DECODER_PACK)).toStrictEqual(NMEA0183_DECODER_PACK);
    expect(descriptor).toMatchObject({
      id: "NMEA-0183",
      revision: "reference-v1",
      packHash: NMEA0183_DECODER_PACK.integrity.canonicalSha256,
      runtimeId: "nmea0183-line-v1",
      runtimeRevision: "1",
    });
  });

  it("retains uppercase compatibility for legacy schema hashes", () => {
    expect(resolveDecoderPack({
      id: "NSL-01",
      revision: "v1.3.7",
      schemaHash: decoderDescriptorForPack(NSL01_DECODER_PACK).schemaHash.toUpperCase(),
    })).toBe(NSL01_DECODER_PACK);
  });

  it("rejects a correctly rehashed pack whose schema is incompatible with its runtime", () => {
    const { integrity: _integrity, ...draft } = structuredClone(NMEA0183_DECODER_PACK);
    (draft.schema as { checksum: string }).checksum = "Something else";
    const resealed = sealDecoderPack(draft);

    expect(() => verifyDecoderPackConformance(resealed)).toThrow(
      "NMEA 0183 decoder pack schema is incompatible",
    );
  });

  it("bounds decoder-pack JSON before parsing nested input", () => {
    const nested = `${"[".repeat(65)}0${"]".repeat(65)}`;

    expect(() => parseBoundedDecoderPackJson(nested)).toThrow("64-level nesting limit");
    expect(parseBoundedDecoderPackJson(serializeDecoderPack(NMEA0183_DECODER_PACK)))
      .toStrictEqual(NMEA0183_DECODER_PACK);
  });
});
