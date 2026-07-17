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
- New live captures must emit session format v2 with immutable transport events and a terminal capture-integrity receipt. Keep v1 imports unchanged and label their capture integrity as unknown rather than inferring a clean capture.
- Never infer transport-reported counters from browser or recorder totals. Missing UDP terminal status remains null and yields incomplete `udp-browser-observed` evidence; recorder finalization without adapter evidence remains incomplete and `recorder-only`.
- Reconcile receipt counters and issue codes for every v2 status. Complete event logs require exact matching events; an explicitly incomplete event log may omit an exhausted-budget event but must retain the corresponding receipt code and counters.
- Project transport anomalies as `capture-path` diagnostics so operators can distinguish local capture failures from link, decoder, and unattributed telemetry evidence.
- Evidence exports must produce a real local archive and describe exactly which artifacts they contain.
- Every evidence bundle must include the range-filtered transport event log and the whole-session integrity receipt, even when optional artifact groups are excluded.
- Keep the core decoder, replay, incident, and bundle logic pure and covered by automated tests.
