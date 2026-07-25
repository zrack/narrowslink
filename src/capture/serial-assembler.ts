import type { DecoderPackDocument } from "../domain/decoder-pack";
import {
  Nsl01SerialFrameAssembler,
  type SerialRecordAssembler,
} from "./nsl01-serial-assembler";
import { Nmea0183SerialLineAssembler } from "./nmea0183-serial-assembler";

export type { SerialAssembly, SerialAssemblyKind, SerialRecordAssembler } from "./nsl01-serial-assembler";

export function createSerialAssembler(pack: DecoderPackDocument): SerialRecordAssembler {
  if (pack.runtime.id === "nsl01-binary-v1") return new Nsl01SerialFrameAssembler();
  if (pack.runtime.id === "nmea0183-line-v1" && pack.framing.kind === "delimited-text") {
    return new Nmea0183SerialLineAssembler(pack.framing.maxRecordBytes);
  }
  throw new Error(`Decoder runtime ${pack.runtime.id} does not provide a supported serial assembler.`);
}
