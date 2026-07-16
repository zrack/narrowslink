# NarrowsLink Design QA

## Comparison target

- Source visual truth: `docs/design/narrowslink-mission-timeline-source.png`
- Final browser-rendered implementation: `docs/design/implementation-final-production.png`
- Full source/implementation comparison: `docs/design/comparison-production-final.png`
- Focused comparison: `docs/design/comparison-production-focused.png`
- Responsive implementation: `docs/design/implementation-functional-mobile.png`
- Desktop viewport: `1487 × 1058`, matching the source image.
- Responsive viewport: `390 × 844`; measured document width and scroll width both equal `390 px`.
- State: bundled Harbor relay replay; replay paused at the source-like `23:38` view start; link-fade incident selected; Narrative tab; all five evidence groups selected; deterministic default marker and operator note present.

## Final findings

No actionable P0, P1, or P2 visual findings remain.

The final implementation matches the source's primary composition and geometry: `232 px` source rail, compact session command bar, stacked overview plots, shared time grid, labeled telemetry lanes, `280 px` incident rail, amber half-open incident selection, and the full-width evidence workspace. The interface also retains square controls, quiet one-pixel structure, restrained warm-black surfaces, dense instrument typography, semantic chart colors, and a pale-blue export action.

Four visible differences are intentional and accepted product/data constraints:

- The source mocks several active and recent sessions. The implementation shows the one session actually loaded and does not present invented sessions as available data.
- The source shows a live-follow control. A recorded session truthfully exposes replay controls, while live capture remains available from the source rail and command bar.
- Packet-family gaps, decoder resynchronization, diagnostics, estimates, and bundle metadata are derived from the validated fixture rather than copied as decorative source values.
- Evidence rows describe the real local NarrowsLink archive contents and sizes rather than the source's illustrative PCAP and `24.7 MB` copy.

## Focused comparison evidence

- Timeline: the final comparison confirms equivalent label and scale gutters, minute-aligned ticks, connection/throughput/loss order, five packet-family bands, extended decoder-resync state, diagnostic and marker lanes, geographic traces, and selected-range treatment.
- Incident rail: the final comparison confirms equivalent range summary, selector, semantic tabs, compact chronological narrative, severity dots, and session-wide operator-note region.
- Evidence workspace: the final comparison confirms equivalent summary-to-table hierarchy, five inclusion rows, operator context, estimated size/group count, and source-aligned primary export placement.
- Source rail and header: widths, dividers, title/meta hierarchy, compact replay actions, source navigation, and capture entry align with the prototype while remaining truthful to the one loaded replay.

## Comparison history

### Pass 0 — current product baseline

- Findings: shell proportions, header metadata, source-rail density, overview anatomy, packet-family cadence, incident density, and evidence-workspace geometry visibly diverged from the source.

### Pass 1 — composition and visual-system alignment

- Fixes: aligned the three-column shell, warmer palette, compact command geometry, independent overview bands, shared timeline grid, family-lane anatomy, six-event narrative, and evidence-panel proportions.
- Remaining findings: the fixture produced overly flat throughput, a very short resynchronization state, and an artificial overview spike.

### Pass 2 — evidence-backed replay shaping

- Fixes: regenerated the deterministic fixture with varied cadence, a real fade, packet loss, malformed-frame retention, and a longer decoder-resynchronization sequence; added pure-domain assertions for those properties.
- Remaining finding: global cadence modulation still created a visually artificial overview peak.

### Pass 3 — final axis and fixture alignment

- Evidence: `docs/design/implementation-final-production.png`, `docs/design/comparison-production-final.png`, `docs/design/comparison-production-focused.png`, and `docs/design/implementation-functional-mobile.png`.
- Fixes: removed the artificial fixture spike, aligned the initial replay window and minute ticks, reserved the right scale gutter, tuned chart domains and incident extent, and corrected compact family-lane label spacing.
- Result: no actionable P0, P1, or P2 differences remain.

## Required fidelity surfaces

- Fonts and typography: bundled Inter carries interface copy and IBM Plex Mono carries times, values, and protocol metadata. Uppercase micro-labels, numeric alignment, weight, and dense line heights were checked in the focused comparison.
- Spacing and layout rhythm: the viewport, rail and incident-panel widths, header and overview heights, label/scale gutters, lane baselines, evidence proportions, dividers, and square corners were compared against the source at identical dimensions.
- Colors and visual tokens: warm near-black surfaces, muted gray structure, amber incident selection, green link/position data, blue throughput, red loss, purple markers, cyan packet-family data, and pale-blue primary actions preserve the source semantics.
- Image and icon fidelity: the repository's NarrowsLink mark is reused as a real image asset. The source contains no photography or illustration. Recharts renders data plots and Phosphor supplies the icon family; no placeholder art, emoji, or improvised CSS/SVG illustration was introduced.
- Copy and content: session metadata, diagnostics, units, decoder state, bundle contents, and privacy language remain coherent and derived from the same replay pipeline instead of reproducing contradictory prototype numbers.
- Responsiveness: at `390 × 844`, the page has no horizontal body overflow, labels no longer collide, the command strip remains reachable, the telemetry surface uses its deliberate internal scroller, and panels preserve the desktop hierarchy.
- Accessibility review: semantic buttons, native checkboxes/selects, labels, tabs, dialogs, focus treatment, status text, chart summaries, disabled states, and reduced-motion behavior were inspected. This is not a claim of full accessibility compliance; screen-reader and 200% zoom matrices remain follow-up coverage.

## Primary interactions tested

- Played and paused the replay and changed speed to `2×`; the monotonic replay state updated as expected.
- Opened and closed the marker dialog.
- Switched from Narrative to Details and restored Narrative.
- Opened and cancelled the evidence-bundle confirmation without creating an unwanted download.
- Opened and closed the live UDP/serial capture setup.
- Verified the final desktop document is exactly `1487 × 1058` with no page overflow.
- Verified the final responsive document width is exactly `390 px` with no body overflow.
- Checked browser warnings and errors after a clean reload: none.
- Ran `npm run check`: TypeScript validation, `92` tests across `14` files, and the production Vite build passed.

## Follow-up polish

- [P3] Add an automated keyboard-navigation, screen-reader, and 200% browser-zoom matrix.
- [P3] Add real session-history entries to the left rail once the application has persisted more than one genuine source; do not backfill decorative records.

## Implementation checklist

- [x] Preserve the approved mission-timeline composition and instrument-grade visual language.
- [x] Match source and implementation at the same viewport and replay state.
- [x] Keep the fixture and imported sources on the same validation, decode, replay, incident, and export pipeline.
- [x] Preserve malformed and partial frames as inspectable diagnostics.
- [x] Verify desktop, responsive, and primary interaction states.
- [x] Resolve every P0, P1, and P2 visual QA finding.

final result: passed
