# Changelog

All notable changes to NarrowsLink are recorded here. This is the canonical project history: the README describes the product as it works now, the use-case log catalogs current operator outcomes, the roadmap contains planned work, the design QA record holds the currently accepted visual evidence, and collaboration documents define current policy.

## [Unreleased]

### Added

- Added bounded, content-addressed decoder packs with an allowlisted parser runtime, canonical pack and schema identities, production-path conformance fixtures, local operator loading, and packaged `decoder seal` and `decoder validate` commands; new captures persist the exact pack and runtime while legacy NSL-01 sessions remain compatible and unchanged.
- Added the NMEA 0183 reference pack for checksummed GGA, RMC, and HDT sentences over one-sentence-per-datagram UDP or line-delimited serial input, including partial-tail retention, checksum diagnostics, real loopback UDP capture, local-library reopen, evidence export, and production receiver replay verification.
- Added an in-application receiver workspace for untrusted version 3 `.nlb` bundles: worker-isolated production verification now precedes inspection, the exact bounded incident is reconstructed only from included evidence, excluded context remains explicit, and internal consistency, evidence completeness, and unsigned authenticity remain separate claims.
- Added receiver-owned findings stored separately under the whole-bundle SHA-256 without modifying source evidence, plus NSL-01 and NMEA capture-to-receiver, rejection recovery, reload, accessibility, responsive-layout, and unpacked-release replacement coverage across Chromium, Firefox, and WebKit.
- Added bounded comparative replay for a selected session incident or verified evidence-bundle range against a validated `.nlsession` or verified `.nlb`: explicit range-start or named shared-event alignment, exact overlap and unmatched-tail accounting, conservative evidence comparability, traceable metric deltas, and a checksummed `.nlcompare.json` finding that cites but never modifies or embeds either source.
- Added a controlled real-UDP regression proof with one induced integrity failure, semantic finding validation, responsive and axe coverage, and unpacked-release receiver-to-session comparison across Chromium, Firefox, and WebKit.
- Added worker-isolated session import and saved-session reopen with deterministic chunk transfer, weighted phase progress, and cancellation that preserves the active workspace and never persists partial content; candidate loading, bounded comparison construction, and evidence-bundle construction use the same cancellable processing boundary.
- Added a streamed deterministic 200,000-record acceptance corpus and source plus unpacked-release browser gates that import, persist, cancel, reopen, compare an exact 10,000-record range, cancel and rebuild a bundle, and verify its contents in Chromium, Firefox, and WebKit against published heartbeat and Chromium heap-growth budgets.
- Added version 3 IndexedDB session records containing exact canonical bytes, with validated read compatibility for existing version 1 text and version 2 Blob records.

### Changed

- Defined NarrowsLink's product goal and success criteria around reproducible constrained-telemetry incidents and independently verified handoffs; retained the strategic product directions and moonshot opportunities while keeping delivered capabilities in the changelog and current-state docs.
- Expanded UC-001 with supported radio transport capture topologies, including USB serial radio, UDP base-station output, forwarded UDP copies, and network multicast observer setup and test paths.
- Raised the imported and saved replay envelope from 32 MiB and 100,000 records to 64 MiB and 200,000 records while retaining the separate live-capture ceiling of 100,000 records, 32 MiB of retained payload bytes, 24 hours, and a canonical file within the replay limit.

## [0.1.0] - 2026-07-24

### Added

- Reproducible, dependency-free operator distribution containing the production UI, authenticated UDP bridge, deterministic fixture, and receiver CLI; one `narrowslink serve` command starts the managed local application without token transfer, while release assets include exact build identity, a normalized CycloneDX SBOM, published checksums, and an unpacked-artifact capture-to-verification acceptance gate.
- Cross-browser release gate for the complete UDP capture-to-evidence loop, including real loopback recording, `.nlsession` reimport and deduplication, replay and authored investigation context, independently verified `.nlb` contents and checksums, reload/reopen/removal, and surfaced storage or download failures.
- Cross-browser simulated Web Serial capture-to-evidence release gate, including fragmented reads, complete and partial NSL-01 assembly, reconciled v2 integrity and device provenance, canonical-session deduplication and reopen, exact-range export, and production receiver verification, while retaining physical hardware and native permission behavior as a manual boundary.
- Automated axe rules tagged WCAG A/AA, critical keyboard and focus-handoff coverage, narrow and `200%`-equivalent reflow checks, forced-color evidence cues, and a documented accessibility support boundary.
- Content-addressed local session library with IndexedDB persistence, real session metadata, validated reopen, exact-content deduplication, explicit replay-and-workspace removal, and surfaced storage, cleanup, or corruption failures.
- Canonical use-case log with stable IDs, actors, outcomes, current constraints, and implementation evidence for five supported workflows.
- Mission-timeline-first local session review with a deterministic bundled replay, one synchronized replay clock, telemetry and decoder lanes, incident narrative, details and statistics, markers, and operator notes.
- Validated session import and NSL-01 decoding that preserve malformed and partial frames while deriving link, inferred missing-frame, jitter, decoder, diagnostic, and decoded-signal evidence.
- Bounded live UDP and Web Serial capture, including an authenticated local UDP bridge and stop/save/replay through the same validation and decoder pipeline used by imported sessions.
- Operator-authored half-open incident ranges with exact microsecond boundary editing, timeline resizing, per-session persistence, and exact-range export. (#17)
- Session format v2 transport-event logs and terminal capture-integrity receipts, capture-path diagnostics, and explicit unknown integrity for unchanged legacy v1 imports. (#18)
- Independently auditable transport provenance for new captures, including per-datagram UDP endpoint attribution, a bounded bridge-side lifecycle journal, explicit unavailable host drop counters, serial device and negotiated-setting evidence, a structured workspace inspector, and mandatory provenance artifacts in evidence bundles.
- Locally generated `.nlb` evidence archives with selectable artifacts, mandatory transport events, provenance, bridge journals, and integrity receipts, plus manifest metadata, record counts, byte sizes, and SHA-256 checksums.
- Production receiver CLI for bounded, offline verification of version 3 `.nlb` bundles, with strict archive, path, artifact, session-duration, and cross-document validation; human-readable and stable JSON reports; and separate internal-integrity, evidence-completeness, and unsigned-authenticity verdicts.
- MIT licensing.
- GitHub collaboration infrastructure, including CI, issue forms, pull-request guidance, Dependabot, security and support policies, and a code of conduct. (#5, #14)

### Changed

- Made diagnostic severity and selected-incident state perceivable without color, made narrow timeline and evidence regions keyboard-scrollable, and preserved focus across capture phases, destructive confirmations, incident replacement, and responsive command wrapping.
- Renamed the project to NarrowsLink and adopted the mission-timeline-first product direction.
- Aligned the runnable desktop and responsive workspaces with the approved prototype and evidence-backed replay state.
- Separated optional Diagnostics from mandatory Capture integrity in bundle selection while keeping all six evidence controls visible in the accepted desktop workspace. (#18)
- Made this changelog the sole chronological project record and refocused the README, roadmap, design QA record, agent guidance, and contributor workflow on their current responsibilities.

### Security

- Restricted the UDP bridge control plane to loopback access with server-enforced capture ownership and an internal short-lived bearer credential; the browser uses a same-origin application relay, so the credential is not exposed in runtime metadata, URLs, cookies, readiness output, or logs.

[Unreleased]: https://github.com/zrack/narrowslink/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zrack/narrowslink/releases/tag/v0.1.0
