# NarrowsLink roadmap

NarrowsLink now has a working replay-first foundation: a validated session format, deterministic decoder and replay core, mission-timeline operator workspace, and verifiable local evidence export. The next phase is to extend that foundation without weakening its timing, provenance, or failure-visibility guarantees.

## Delivered foundation

Status: complete for the current replay application

- React 19, TypeScript, and Vite application shell with repeatable development, test, typecheck, and production-build commands.
- Versioned `narrowslink/session` v1 domain model using integer microsecond offsets from a UTC start.
- Zod document validation plus cross-record checks for identifiers, source references, monotonic time, duration bounds, byte counts, and IANA time zones.
- Deterministic 18,402-record synthetic fixture and checked-in generator.
- Pure domain modules with focused Vitest coverage.
- MIT licensing and contributor documentation.

## Delivered replay and ingestion

Status: complete for local file replay

- Bundled fixture and user-selected files pass through the same validation, decoding, diagnostics, incident, and export pipeline.
- Local `.json` and `.nlsession` import with explicit loading and error states.
- Monotonic replay clock with play, pause, reset, seek, and `0.5×` through `16×` rate control.
- One replay offset drives the overview scrubber, mission timeline, current metrics, diagnostics, and marker placement.
- Exact half-open range helpers for incident projection and evidence filtering.
- Source records stay immutable throughout processing.

## Delivered decoder and diagnostics

Status: complete for NSL-01 v1

- Little-endian `A55A` frame envelope with sequence, device time, payload length, and CRC-16/CCITT-FALSE validation.
- Canonical byte-level schema for every envelope and family field, cryptographically bound to the supported decoder descriptor.
- Built-in Heartbeat, Power, Attitude, Position, and Thermal packet decoders.
- Decoded fields retain units, quality, integrity status, source-record linkage, and source provenance.
- Missing sync words, CRC failures, truncated payloads, invalid lengths, and unknown families remain inspectable.
- Derived one-second link, loss, throughput, jitter, position, thermal, power, and packet-family metrics.
- Derived degradation, loss burst, checksum, partial-frame, resync, lock, and recovery diagnostics.

## Delivered operator workspace

Status: complete for incident review

- Mission-timeline-first desktop workspace with a whole-session overview and synchronized incident detail.
- Selectable incident presets with narrative, detail, and statistics views.
- Time-zone-aware presentation while preserving integer UTC-relative offsets internally.
- Replay-linked link quality, throughput, sequence loss, packet-family, decoder, diagnostic, marker, and signal lanes.
- Per-session operator markers and notes persisted in browser local storage.
- Responsive layouts and baseline keyboard/ARIA semantics for core controls.

## Delivered evidence handoff

Status: complete for local incident bundles

- Real `.nlb` ZIP download generated in the browser.
- Exact incident-range filtering using `[startUs, endUs)` semantics.
- Configurable raw records, decoded packets, diagnostics, schema context, markers, and notes.
- Canonical manifest with session, decoder, selection, inclusion, byte-size, media-type, record-count, and hash metadata.
- SHA-256 checksums for the manifest and every included evidence artifact.
- Stable archive bytes when inputs and generation time are held constant.

## Next: live UDP and serial sources

- Define source adapters that emit the existing immutable `SourceRecord` shape.
- Add UDP multicast/unicast and serial configuration, health, start/stop, and permission flows.
- Record live input into a versioned session document without changing replay semantics.
- Make operating-system drops, transport errors, disconnects, and partial reads first-class events.
- Prove that a recorded live session replays into the same frames, diagnostics, incidents, and evidence.

Exit criteria: an operator can capture a UDP or serial session locally, stop recording, replay it, and reproduce the same derived result.

## Next: decoder schema extensibility

- Move the canonical built-in schema into a loadable, versioned registry with signature and trust policies.
- Drive field decoding from schema definitions so new field types, scaling, enums, and bounds do not require application code changes.
- Add schema import, compatibility diagnostics, migration rules, and explicit decoder revision history.
- Preserve imported schemas and their cryptographic identities in sessions and evidence bundles.
- Add fixture-driven conformance tests for third-party decoders.

Exit criteria: a contributor can add a decoder schema and fixtures without editing the core frame-processing code.

## Next: large-session processing

- Move validation, decoding, aggregation, and bundle construction off the main UI thread with Web Workers.
- Add streaming JSON/NDJSON ingestion or a chunked binary container for captures beyond the current 32 MB limit.
- Evaluate IndexedDB or an embedded desktop store for indexed frame and metric access.
- Bound timeline downsampling, memory growth, marker lookup, and evidence generation for multi-million-record sessions.
- Add cancellation and progress reporting for long imports and exports.

Exit criteria: large sessions remain responsive, cancellable, and deterministic under documented memory and latency budgets.

## Next: accessibility and end-to-end reliability

- Complete keyboard-only review of replay, timeline, tabs, marker creation, file loading, and bundle export.
- Add focus management for dialogs and error recovery, reduced-motion behavior, and non-color diagnostic cues.
- Verify contrast and responsive behavior across supported viewport and zoom ranges.
- Add browser end-to-end tests for bundled replay, local import, seek/rate behavior, persistence, failures, and `.nlb` download.
- Add automated archive inspection so browser tests verify bundle paths, range boundaries, and hashes.

Exit criteria: critical operator workflows pass automated browser tests and a documented accessibility audit.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
