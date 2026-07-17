# NarrowsLink roadmap

NarrowsLink now has a working local capture-to-evidence foundation: validated UDP and serial recording, a deterministic decoder and replay core, a mission-timeline operator workspace, and verifiable local evidence export. The next phase is to extend that foundation without weakening its timing, provenance, or failure-visibility guarantees.

## Delivered foundation

Status: complete for the current local capture, replay, incident-review, and evidence-export application

- React 19, TypeScript, and Vite application shell with repeatable development, test, typecheck, and production-build commands.
- Versioned `narrowslink/session` v1 domain model using integer microsecond offsets from a UTC start.
- Zod document validation plus cross-record checks for identifiers, source references, monotonic time, duration bounds, byte counts, and IANA time zones.
- Deterministic 18,402-record synthetic fixture and checked-in generator.
- Pure domain modules with focused Vitest coverage.
- MIT licensing and contributor documentation.

## Delivered replay and ingestion

Status: complete for local file and bounded live capture

- Bundled fixture and user-selected files pass through the same validation, decoding, diagnostics, incident, and export pipeline.
- Local `.json` and `.nlsession` import with explicit loading and error states.
- Monotonic replay clock with play, pause, reset, seek, and `0.5×` through `16×` rate control.
- One replay offset drives the overview scrubber, mission timeline, current metrics, diagnostics, and marker placement.
- Exact half-open range helpers for incident projection and evidence filtering.
- Source records stay immutable throughout processing.
- Token-protected loopback UDP bridge with unicast and IPv4/IPv6 multicast, byte-exact datagram forwarding, bounded backpressure, capture ownership, event-sequence gap detection, and final counter reconciliation.
- Direct Web Serial capture with permission-aware start, lifecycle/error handling, bounded NSL-01 assembly, noise retention, and prompt frame-boundary recovery after corrupt headers.
- Derived decoder recovery remains visible until at least three valid CRC frames span 40 uninterrupted seconds, preventing a single good frame from claiming relock.
- Stop/save produces an importable version 1 `.nlsession` and immediately reopens it through the existing decoder, replay, incident, and export pipeline.
- Recorder budgets include serialized JSON overhead so an accepted capture remains below the browser importer limit.

## Delivered decoder and diagnostics

Status: complete for NSL-01 v1

- Little-endian `A55A` frame envelope with sequence, device time, payload length, and CRC-16/CCITT-FALSE validation.
- Canonical byte-level schema for every envelope and family field, cryptographically bound to the supported decoder descriptor.
- Built-in Heartbeat, Power, Attitude, Position, and Thermal packet decoders.
- Decoded fields retain units, quality, integrity status, source-record linkage, and source provenance.
- Missing sync words, CRC failures, truncated payloads, invalid lengths, and unknown families remain inspectable.
- Derived one-second link, received-packet-rate, inferred missing-frame, jitter, position, thermal, power, and packet-family metrics. Missing-frame estimates reconcile available transport-drop counters with trusted decoder sequence gaps without double counting the same episode.
- Derived degradation, inferred missing-frame (loss-burst), checksum, partial-frame, resync, lock, and recovery diagnostics.

## Delivered operator workspace

Status: complete for preset and operator-authored incident review

- Mission-timeline-first desktop workspace with a whole-session overview and synchronized incident detail.
- Selectable replay presets and separate operator-authored incident overlays with narrative, detail, and statistics views.
- Playhead-centered range creation, exact integer-microsecond editing, title and severity editing, timeline-handle resizing, guarded deletion, and source-preset refinement into a local copy.
- Versioned per-session local persistence for authored ranges, including v1 marker/note workspace migration and collision-safe validation against replay preset IDs.
- Immediate re-projection of diagnostics and statistics after a boundary change, with the selected authored range feeding replay context and evidence export through the existing pipeline.
- Time-zone-aware presentation while preserving integer UTC-relative offsets internally.
- Replay-linked link quality, received packet rate, inferred missing-frame, packet-family, decoder, diagnostic, marker, and signal lanes.
- Per-session operator markers and notes persisted in browser local storage.
- Responsive layouts and baseline keyboard/ARIA semantics for core controls.

## Delivered prototype-fidelity pass

Status: complete at the approved desktop reference state

- Source-aligned `232 px` session rail, compact replay command bar, stacked whole-session overview, shared-grid mission timeline, `280 px` incident rail, and evidence workspace.
- Minute-aligned timeline ticks, explicit right-side value scales, packet-family cadence bands, sustained decoder-resynchronization state, and a source-like incident context window.
- Deterministic fixture shaping that produces a real fade, inferred missing frames, malformed-frame diagnostics, recovery shoulders, and decoder relock without decorative chart-only data.
- Matched `1487 × 1058` source/implementation comparison plus a `390 × 844` responsive browser review with no body overflow.
- Persistent comparison history and accepted product/data differences in `design-qa.md`.

## Delivered evidence handoff

Status: complete for local incident bundles

- Real `.nlb` ZIP download generated in the browser.
- Exact incident-range filtering using `[startUs, endUs)` semantics.
- Configurable raw records, decoded packets, diagnostics, schema context, markers, and notes.
- Canonical manifest with session, decoder, selection, inclusion, byte-size, media-type, record-count, and hash metadata.
- SHA-256 checksums for the manifest and every included evidence artifact.
- Stable archive bytes when inputs and generation time are held constant.

## Next: decoder schema extensibility

- Move the canonical built-in schema into a loadable, versioned registry with signature and trust policies.
- Drive field decoding from schema definitions so new field types, scaling, enums, and bounds do not require application code changes.
- Add schema import, compatibility diagnostics, migration rules, and explicit decoder revision history.
- Preserve imported schemas and their cryptographic identities in sessions and evidence bundles.
- Add fixture-driven conformance tests for third-party decoders.

Exit criteria: a contributor can add a decoder schema and fixtures without editing the core frame-processing code.

## Next: large-session processing

- Move validation, decoding, aggregation, and bundle construction off the main UI thread with Web Workers.
- Add streaming JSON/NDJSON ingestion or a chunked binary container for captures beyond the current 32 MiB UTF-8 `.nlsession` import limit.
- Evaluate IndexedDB or an embedded desktop store for indexed frame and metric access.
- Bound timeline downsampling, memory growth, marker lookup, and evidence generation for multi-million-record sessions.
- Add cancellation and progress reporting for long imports and exports.

Exit criteria: large sessions remain responsive, cancellable, and deterministic under documented memory and latency budgets.

## Next: durable transport provenance

- Add a versioned transport-event stream for disconnects, socket errors, operating-system drop counters, backpressure, capture cancellation, and unconfirmed shutdown.
- Persist per-datagram remote UDP endpoint metadata without weakening the current immutable raw-byte model.
- Distinguish captured payload bytes from measured or estimated link-layer wire bytes.
- Include transport events and provenance in incident projection, bundle manifests, raw evidence, and checksums.

Exit criteria: a replay and its evidence bundle can explain both the retained telemetry and every known transport-level gap or shutdown anomaly without relying on transient UI state.

## Next: accessibility and end-to-end reliability

- Automate the keyboard-only review of replay, timeline, tabs, marker creation, file loading, and bundle export.
- Add a documented screen-reader matrix and verify non-color diagnostic cues across supported combinations.
- Verify contrast and responsive behavior across supported viewport and `200%` zoom ranges.
- Add browser end-to-end tests for bundled replay, local import, seek/rate behavior, persistence, failures, and `.nlb` download.
- Add automated archive inspection so browser tests verify bundle paths, range boundaries, and hashes.

Exit criteria: critical operator workflows pass automated browser tests and a documented accessibility audit.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
