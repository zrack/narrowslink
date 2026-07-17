# NarrowsLink roadmap

This file contains future work only. See [README.md](README.md) for current capabilities and [CHANGELOG.md](CHANGELOG.md) for completed changes. The work areas below are planned; their order does not promise release sequence or timing.

## Decoder schema extensibility

- Move the canonical built-in schema into a loadable, versioned registry with signature and trust policies.
- Drive field decoding from schema definitions so new field types, scaling, enums, and bounds do not require application code changes.
- Add schema import, compatibility diagnostics, migration rules, and explicit decoder revision history.
- Preserve imported schemas and their cryptographic identities in sessions and evidence bundles.
- Add fixture-driven conformance tests for third-party decoders.

Exit criteria: a contributor can add a decoder schema and fixtures without editing the core frame-processing code.

## Large-session processing

- Move validation, decoding, aggregation, and bundle construction off the main UI thread with Web Workers.
- Add streaming JSON/NDJSON ingestion or a chunked binary container for captures beyond the current 32 MiB UTF-8 `.nlsession` import limit.
- Evaluate IndexedDB or an embedded desktop store for indexed frame and metric access.
- Bound timeline downsampling, memory growth, marker lookup, and evidence generation for multi-million-record sessions.
- Add cancellation and progress reporting for long imports and exports.

Exit criteria: large sessions remain responsive, cancellable, and deterministic under documented memory and latency budgets.

## Full transport provenance

- Add a capture-scoped bridge-side event journal so socket, multicast, backpressure, and shutdown history survives even when the browser event stream is the failed channel.
- Add operating-system drop counters where the host platform exposes them.
- Persist per-datagram remote UDP endpoint metadata without weakening the current immutable raw-byte model.
- Distinguish captured payload bytes from measured or estimated link-layer wire bytes.
- Preserve serial device identity and negotiated settings in structured session provenance.

Exit criteria: the browser receipt can be cross-checked against a durable bridge journal and platform counters, and each retained datagram can be attributed to its remote endpoint.

## Accessibility and end-to-end reliability

- Automate the keyboard-only review of replay, timeline, tabs, marker creation, file loading, and bundle export.
- Add a documented screen-reader matrix and verify non-color diagnostic cues across supported combinations.
- Verify contrast and responsive behavior across supported viewport and `200%` zoom ranges.
- Add browser end-to-end tests for bundled replay, local import, seek/rate behavior, persistence, failures, and `.nlb` download.
- Add automated archive inspection so browser tests verify bundle paths, range boundaries, and hashes.

Exit criteria: critical operator workflows pass automated browser tests and a documented accessibility audit.

## Persisted session library

- Persist and reopen more than one genuine local session.
- Populate the source rail from saved session metadata rather than decorative records.
- Define explicit deletion and storage-limit behavior without weakening the immutable source-evidence model.

Exit criteria: an operator can save, reopen, identify, and remove real local sessions from the source rail with predictable storage behavior.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
