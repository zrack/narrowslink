# Changelog

All notable changes to NarrowsLink are recorded here. This is the canonical project history: the README describes the product as it works now, the use-case log catalogs current operator outcomes, the roadmap contains planned work, the design QA record holds the currently accepted visual evidence, and collaboration documents define current policy.

NarrowsLink has not published a tagged release. Until a maintainer publishes a matching Git tag and GitHub Release, completed work remains under `[Unreleased]`; the private `package.json` version is not treated as release evidence.

## [Unreleased]

### Added

- Cross-browser release gate for the complete UDP capture-to-evidence loop, including real loopback recording, `.nlsession` reimport and deduplication, replay and authored investigation context, independently verified `.nlb` contents and checksums, reload/reopen/removal, and surfaced storage or download failures.
- Automated axe rules tagged WCAG A/AA, critical keyboard and focus-handoff coverage, narrow and `200%`-equivalent reflow checks, forced-color evidence cues, and a documented accessibility support boundary.
- Content-addressed local session library with IndexedDB persistence, real session metadata, validated reopen, exact-content deduplication, explicit replay-and-workspace removal, and surfaced storage, cleanup, or corruption failures.
- Canonical use-case log with stable IDs, actors, outcomes, current constraints, and implementation evidence for five supported workflows.
- Mission-timeline-first local session review with a deterministic bundled replay, one synchronized replay clock, telemetry and decoder lanes, incident narrative, details and statistics, markers, and operator notes.
- Validated session import and NSL-01 decoding that preserve malformed and partial frames while deriving link, inferred missing-frame, jitter, decoder, diagnostic, and decoded-signal evidence.
- Bounded live UDP and Web Serial capture, including a token-protected local UDP bridge and stop/save/replay through the same validation and decoder pipeline used by imported sessions.
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

- Restricted the UDP bridge control plane to loopback access with token authentication and server-enforced capture ownership.
