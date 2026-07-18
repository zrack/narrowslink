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

## Host transport attestation

- Add operating-system UDP drop counters on host and runtime combinations that expose a trustworthy capture-scoped value, with an explicit adapter and observation source for every platform.
- Distinguish captured payload bytes from measured or estimated IP, UDP, and link-layer wire bytes without presenting estimates as observations.
- Evaluate optional signing or trusted-channel anchoring for bridge journals and bundle identities; current checksums prove internal consistency, not author or build authenticity.

Exit criteria: supported host adapters can add independently sourced platform counters and optional authenticity evidence without weakening the explicit unavailable state on other platforms.

## Assistive-technology certification

- Run and record structured VoiceOver reviews with packaged Safari on macOS and iOS or iPadOS.
- Run and record NVDA reviews with packaged Firefox and Chromium-based browsers on Windows.
- Add JAWS coverage when a licensed Windows test environment is available.
- Verify native `200%` browser zoom with operating-system scaling across the packaged browser matrix, beyond the current automated CSS-viewport proxy.
- Exercise physical Web Serial device selection, disconnect, failure recovery, and permission behavior with representative adapters and drivers.

Exit criteria: [ACCESSIBILITY.md](ACCESSIBILITY.md) records reproducible manual results for the supported browser, operating-system, screen-reader, zoom, and Web Serial hardware combinations without broadening claims beyond tested evidence.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
