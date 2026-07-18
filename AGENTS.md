# NarrowsLink Application Instructions

Run the local server yourself and open the application in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

Treat `docs/design/narrowslink-mission-timeline-source.png` as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Selected Product Direction

- The approved concept is the mission-timeline-first NarrowsLink session review workspace.
- The primary outcome is to correlate link health, packet behavior, decoder state, diagnostics, markers, and decoded signals across a recorded session, then package a selected incident range into a reproducible handoff bundle.
- Preserve the restrained, square-cornered, instrument-grade visual language of the existing NarrowsLink prototype.
- Prototype fidelity is the current priority: treat visible differences in composition, component geometry, density, spacing, typography, color, and hierarchy from the source image as product defects rather than optional polish.

## Product Engineering Constraints

- The bundled replay fixture and user-imported files must travel through the same validation, decoding, replay, incident, and export pipeline.
- One monotonic replay clock drives the playhead, decoded values, diagnostics, incident selection, and timeline state.
- Keep raw records immutable. Derive frames, packets, diagnostics, incidents, and bundle artifacts from versioned schemas.
- Store times as integer microsecond offsets from a UTC session start. Display them in the session's declared IANA timezone.
- Incident ranges are half-open: `[startUs, endUs)`.
- Preserve malformed and partial frames as inspectable diagnostics; do not silently discard them.
- Persist only validated canonical session documents in the local library. Use SHA-256 over canonical `.nlsession` bytes as the content identity, keep exact duplicate saves idempotent, and do not rewrite v1 imports as v2.
- Reopen a library entry only after re-hashing its stored bytes, verifying canonical content and metadata, parsing JSON, and running the existing session validation and decoder pipeline. Treat mismatches as corruption rather than silently repairing or replacing evidence.
- Do not claim that a session is saved until its IndexedDB transaction commits. Enforce the shared 32 MiB canonical-file limit before opening the database, and surface oversized sessions, unavailable storage, quota exhaustion, blocked opens, transaction failures, corruption, and missing entries while keeping an already validated in-memory replay usable.
- Removing a saved replay must also attempt to clear its separately persisted marker, note, and authored-range workspace. Keep an active in-memory replay open, leave exported files untouched, and surface a persistent residual-workspace warning when the replay is removed but workspace cleanup cannot complete.
- Populate the Sessions rail only from genuine loaded or persisted session state. Never add decorative session rows; preserve the source-aligned two-line density and provide the same real library through a labeled narrow-screen dialog.
- New live captures must emit session format v2 with immutable transport events and a terminal capture-integrity receipt. Keep v1 imports unchanged and label their capture integrity as unknown rather than inferring a clean capture.
- Never infer transport-reported counters from browser or recorder totals. Missing UDP terminal status remains null and yields incomplete `udp-browser-observed` evidence; recorder finalization without adapter evidence remains incomplete and `recorder-only`.
- Reconcile receipt counters and issue codes for every v2 status. Complete event logs require exact matching events; an explicitly incomplete event log may omit an exhausted-budget event but must retain the corresponding receipt code and counters.
- Preserve transport provenance as explicit evidence rather than inference. New UDP captures must retain each remote endpoint and the bridge's bounded capture journal; new serial captures must retain the selected device identifiers the browser exposes and the negotiated port settings. Represent unavailable host counters as null with their evidence source, never as zero.
- Project transport anomalies as `capture-path` diagnostics so operators can distinguish local capture failures from link, decoder, and unattributed telemetry evidence.
- Evidence exports must produce a real local archive and describe exactly which artifacts they contain.
- Every evidence bundle must include the range-filtered transport event log, whole-session provenance and bridge-journal artifacts, and whole-session integrity receipt, even when optional artifact groups are excluded.
- Keep the core decoder, replay, incident, and bundle logic pure and covered by automated tests.
- Preserve the cross-browser release gate from real loopback UDP capture through validated `.nlsession` reimport, replay, operator-authored evidence, independently verified `.nlb` archive, persistence, failure recovery, and removal. Keep physical Web Serial and manual assistive-technology claims explicitly separate from automated browser-engine evidence.

## Documentation Ownership

- `CHANGELOG.md` is the sole chronological record of notable completed changes and releases. Add applicable work under `[Unreleased]`.
- `README.md` describes the product as it works now; do not append delivery history or completed milestone notes to it.
- `USE_CASES.md` owns stable operator use-case IDs, current support status, constraints, and implementation evidence. Update entries in place and record their historical changes only in the changelog.
- `ROADMAP.md` contains planned work only. When a milestone is completed, remove it from the roadmap and record the delivered outcome in the changelog rather than relabeling it as delivered.
- `design-qa.md` records the currently accepted visual baseline and verification evidence, not a pass-by-pass product history.
- `CONTRIBUTING.md`, the pull-request template, and other collaboration documents define current process and policy; replace superseded guidance instead of accumulating historical notes.
- Update each document only when the current truth it owns changes. Do not duplicate changelog entries across documentation.
