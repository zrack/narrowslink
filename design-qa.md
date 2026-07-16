# NarrowsLink Design QA

## Comparison target

- Source visual truth: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/narrowslink-mission-timeline-source.png`
- Final browser-rendered implementation: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/implementation-final-production.png`
- Responsive implementation: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/implementation-functional-mobile.png`
- Current live-capture setup: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/live-capture-setup.jpg`
- Current captured-session replay: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/live-capture-replay.jpg`
- Full-view comparison: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/comparison-production-final.png`
- Full plus focused comparison: `/Users/scottzeitner/Documents/Narrow Telemetry Terminal/docs/design/comparison-production-focused.png`
- Desktop browser frame: `1280 × 720`; full-page capture: `1280 × 820`
- Responsive viewport: `390 × 844`
- State: bundled Harbor relay replay; link-fade incident selected; Narrative tab; replay paused at the incident start; all five evidence groups selected.

## Findings

No actionable P0, P1, or P2 findings remain in the final implementation.

The final comparison preserves the source's primary composition: narrow source rail, compact command bar, full-session locator, synchronized stacked telemetry lanes, amber incident range, right-side narrative, and bottom evidence workspace. The implementation also retains the source's square controls, dense instrument typography, quiet dividers, near-black surfaces, semantic chart colors, and pale-blue export action.

Three content differences are intentional and accepted:

- The source shows several mocked active and recent links; the implementation shows the one replay that is actually loaded. This avoids representing unavailable sessions as functional data.
- The source's bundle size is illustrative; the implementation estimates its selected NDJSON/CSV/JSON contents from the actual incident and reports the real compressed size after export.
- The source's fixed narrative and chart numbers are replaced by metrics and diagnostics derived from the validated replay. Layout and hierarchy remain equivalent while values are evidence-backed.

## Focused comparison evidence

- Timeline: the focused comparison confirms the same label gutter, shared vertical time grid, connection/throughput/loss order, five packet-family bands, decoder state, diagnostic and marker lanes, geographic traces, and selected-range treatment. Real diagnostic events use two vertical rows when timestamps cluster, preventing the collisions seen in the first production capture.
- Evidence workspace: the focused comparison confirms the same summary-to-table hierarchy, five inclusion rows, operator context, estimated size/group count, and primary export placement. Native checkboxes replace decorative checkbox buttons without changing the visual anatomy.
- Incident rail: the combined comparison is readable enough to verify the range, selector, semantic tabs, chronological event rule, severity dots, narrative hierarchy, and local operator-note region. The complete reference and browser frames use equal panel bounds, with the fidelity-critical surfaces enlarged in the focused sheet.

## Comparison history

### Production iteration 1 — blocked

- [P2] Persistent command controls overflowed at the target width.
  - Evidence: `docs/design/implementation-functional-current.png` clipped the incident-bundle action at the right edge.
  - Fix: at widths up to 1540 px, the secondary session-meta column collapses and its date remains in the title kicker, preserving all replay, marker, and export controls.
- [P2] Decoder revision copy rendered with a duplicated `v` prefix.
  - Evidence: the first capture showed `vv1.3.7` in the rail, timeline, and bundle table.
  - Fix: revision display now normalizes already-prefixed schema revisions through one formatting helper.
- [P2] Closely timed diagnostic labels collided in the shared timeline.
  - Evidence: `docs/design/implementation-functional-final.png` showed several labels occupying the same baseline.
  - Fix: the lane now clusters every diagnostic at chart resolution, centers each cluster on its first real timestamp, and staggers alternate clusters vertically; the incident narrative provides a paged path through every underlying event.

### Production iteration 2 — passed

- Post-fix evidence: `docs/design/implementation-final-production.png` and `docs/design/comparison-production-focused.png`.
- The command bar is complete, revisions are correct, and diagnostic labels remain readable without moving their underlying event positions.
- No actionable P0, P1, or P2 differences remain.

## Required fidelity surfaces

- Fonts and typography: bundled Inter carries interface copy and IBM Plex Mono carries times, values, and protocol metadata. Weight, uppercase micro-labels, line height, tabular alignment, truncation, and dense small-text hierarchy were checked in the focused comparison. The source and implementation have equivalent optical density.
- Spacing and layout rhythm: the final frame, rail and incident-panel widths, row heights, label gutter, timeline baselines, bundle proportions, one-pixel dividers, and square corners match the target. No persistent control is hidden at the desktop target.
- Colors and visual tokens: warm near-black surfaces, muted gray structure, amber incident selection, green link/position data, blue throughput, red loss, purple markers, cyan family data, and pale-blue primary actions map directly to the source semantics. Disabled states remain visibly distinct.
- Image quality and asset fidelity: the repository's NarrowsLink mark is reused as a real image asset. The target contains no photography or illustration. Recharts renders telemetry plots and Phosphor supplies a consistent icon family; no emoji, placeholder art, custom CSS illustration, or improvised SVG replacement is present.
- Copy and content: session metadata, diagnostics, units, decoder state, bundle contents, and privacy language are coherent in the standalone application. Dynamic values are derived from the same replay and do not retain contradictory prototype numbers.
- Icons: playback, reset, marker, settings, upload, download, package, close, warning, and success controls use one icon system with consistent stroke and scale.
- Responsiveness: at `390 × 844`, the page and live-capture dialog have no horizontal body overflow. The capture form stays inside the viewport and scrolls vertically; the telemetry surface retains a deliberate internal horizontal scroller, the command strip remains horizontally reachable, and stacked panels preserve the desktop hierarchy.
- Accessibility: the implementation uses semantic buttons, native checkboxes and selects, labeled text inputs, WAI-ARIA tabs with roving keyboard focus, trapped/restored modal focus, inert dialog backgrounds, status announcements, visible focus rings, descriptive chart summaries, disabled-state semantics, reduced-motion handling, and a keyboard-operable range input. A full screen-reader matrix and browser zoom pass remain follow-up test coverage rather than a known defect.

## Primary interactions tested

- Loaded and decoded the bundled 18,402-record session through the production file pipeline.
- Played, paused, reset, sought, and changed replay speed; verified the offset advances only while playing.
- Switched incident presets and verified timeline, narrative, and bundle estimates update together.
- Switched Narrative, Details, and Stats through semantic tabs.
- Cleared the incident and verified the empty state, disabled evidence controls, and disabled bundle actions; restored the first incident.
- Added a timestamped, categorized operator marker and verified its timeline position, toast, and persistence after reload.
- Included and excluded evidence groups and verified live file and byte estimates.
- Built the real local `.nlb` archive and reached the success state reporting `29.7 KB` for the tested interference selection.
- Recorded a hardened real loopback UDP acceptance capture with 121 datagrams, including a zero-length datagram; reconciled 121 received and retained records, stopped cleanly, and reopened the immutable `.nlsession` through the production decoder.
- Verified the zero-length datagram remains an inspectable partial-frame diagnostic, selected the full captured interval, and built a checksummed `20.8 KB` `.nlb` evidence bundle from it.
- Checked the workspace and live-capture dialog at `390 × 844` for zero horizontal body overflow.
- Checked browser console warnings and errors after the full interaction pass: none.
- Automated verification: 91 tests across 14 files, TypeScript validation, and a production Vite build passed. Coverage includes the loopback bridge, Web Serial lifecycle, serial frame assembly, bounded capture recording, capture-to-replay parsing, capture-to-bundle byte/hash fidelity, and the complete checked-in 18,402-record fixture.

## Follow-up polish

- [P3] Add an automated keyboard-navigation and 200% browser-zoom matrix to complement the semantic and focus-state review.
- [P3] Move session decoding to a worker before supporting substantially larger replays; the current 5.6 MB fixture remains responsive in the tested browsers.

## Implementation checklist

- [x] Preserve the approved mission-timeline composition and visual language.
- [x] Replace prototype data with one validated replay/decode/diagnostic model.
- [x] Implement replay, seeking, incident selection, markers, local notes, and real evidence export.
- [x] Test desktop, responsive, empty, active, persisted, and success states in the browser.
- [x] Resolve every P0/P1/P2 production QA finding.

final result: passed
