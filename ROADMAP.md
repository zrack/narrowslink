# NarrowsLink roadmap

This file contains planned work only. See [README.md](README.md) for current capabilities, [USE_CASES.md](USE_CASES.md) for supported operator outcomes, and [CHANGELOG.md](CHANGELOG.md) for completed changes. The work areas below are not a release promise or strict sequence; they describe the next product bets that still need design, implementation, and evidence.

## Product goal

**NarrowsLink makes constrained telemetry incidents reproducible.**

NarrowsLink is a local-first evidence workbench that captures the telemetry and transport evidence available at a laptop, replays it deterministically through an identified decoder, and packages an exact incident so another engineer can verify what was observed, what was inferred, and what remains unknown.

This is the target product definition. [README.md](README.md) and [USE_CASES.md](USE_CASES.md) remain authoritative for what the current application supports.

## Success definition

The strongest success test is that a person who was not present during the test can receive a NarrowsLink bundle on another machine, verify it, open the exact incident, inspect the same raw and decoded evidence, understand the capture-path limitations, and continue the investigation without the original system or laptop.

Success requires five properties:

- **Capture truth:** malformed, partial, and failed data are retained. Transport provenance, recorder problems, and unavailable evidence remain explicit.
- **Deterministic interpretation:** the session identifies the exact decoder pack, schema, parser runtime, and revision. Replaying the same input produces the same decoded output and diagnostics.
- **Fast investigation:** an operator can isolate a useful incident range and correlate packet behavior, link state, diagnostics, and decoded values without writing custom analysis code.
- **Independent handoff:** a receiving engineer can verify and inspect the archive offline while clearly distinguishing internal consistency, evidence completeness, and source authenticity.
- **Protocol portability:** a contributor can add a documented decoder pack with fixtures and expected results without modifying NarrowsLink's core capture, replay, or evidence pipeline.

The north-star measure is **successful independently verified incident handoffs**. Count a handoff as successful only when it originates from a real capture, contains an exact incident range, passes verification on another NarrowsLink installation, exposes the same raw and decoded evidence plus known limitations, and remains useful without the original laptop or source system. Track the percentage of shared bundles that recipients successfully verify and open, together with the time from incident selection to verified handoff. Packet counts, sessions saved, dashboard views, and installed decoder counts are not substitutes for that outcome.

## Strategic horizon

The goal positions NarrowsLink as the local evidence layer for constrained telemetry: a tool that lets small teams capture what happened, understand why it happened, and hand off proof without requiring a cloud account, vendor backend, or custom one-off debug script.

The product can move in five useful directions:

- **Field black box for small systems:** turn drones, boats, robots, radios, sensors, research platforms, and embedded devices into systems with replayable incident evidence instead of disposable console logs.
- **Protocol workbench:** give protocol authors a place to ship decoder definitions, fixture captures, expected diagnostics, and conformance tests that other teams can reproduce.
- **Incident handoff format:** make `.nlsession` and `.nlb` files useful as portable evidence packages between operators, maintainers, vendors, educators, and receiving engineers.
- **Local-first reliability lab:** let teams compare firmware, decoder, transport, and field-environment changes against the same capture corpus without uploading sensitive telemetry.
- **Trust boundary demonstrator:** show exactly which claims are observed, inferred, unavailable, internally consistent, or externally authenticated, so investigations do not overstate what the evidence proves.

The near-term roadmap should keep serving those directions. Work that does not improve replayability, decoder portability, incident evidence, local trust, or operator review should be treated as secondary.

## Next milestone: Comparative replay and regression proof

Let a team compare two captures without turning unlike evidence, decoder revisions, or unsynchronized clocks into a false before-and-after claim.

Planned work:

- Accept two validated `.nlsession` files or verified `.nlb` bundles while preserving each input's immutable content identity, decoder identity, capture-integrity assessment, provenance, and evidence availability.
- Require an explicit comparison basis: exact incident ranges, operator-selected anchors, or a declared shared event. Do not imply absolute clock synchronization or equivalent coverage when it is not established.
- Define comparability rules for decoded fields, packet families, diagnostics, transport counters, and derived metrics. Values with different schemas, units, decoder revisions, or evidence bases must remain separate or be marked non-comparable.
- Align the two bounded ranges on one comparison view and expose changes in packet delivery, malformed or partial data, diagnostic rates, link observations, and selected decoded signals without hiding excluded or unavailable evidence.
- Let an engineer drill from every reported difference back to the exact source range and bundle or session identity that supports it.
- Export a local comparison finding that cites both immutable inputs, ranges, decoder identities, alignment choice, computed differences, limitations, and receiver-authored conclusions without modifying either source.
- Prove the workflow with repeatable real captures before and after one controlled radio, firmware, transport, or decoder change.

Exit criteria: an engineer can answer whether one controlled change improved, regressed, or left a constrained-telemetry behavior unresolved, and another engineer can reproduce that conclusion from the same two identified inputs.

## Immediate next moves

- Write the comparison contract before the comparison UI: input identity, acceptable alignment modes, evidence-availability states, comparable metric rules, and result provenance.
- Choose one repeatable real test pair with a controlled impairment and record the expected differences before implementation.
- Decide whether the first proof compares whole sessions, exact incident ranges, or both; prefer exact ranges unless whole-session coverage is demonstrably equivalent.
- Specify field identity across decoder revisions, including unit changes, renamed fields, and schema-incompatible values.
- Define the smallest portable comparison-finding format and how it cites, but never embeds or mutates, the two source artifacts.
- Set latency and memory budgets that remain honest under the current 32 MiB session and 64 MiB evidence-archive limits.

Exit criteria: the comparison semantics, controlled test pair, non-comparable states, and reproducible acceptance case are settled before implementation begins.

## Large-session processing

- Move validation, decoding, aggregation, and bundle construction off the main UI thread with Web Workers.
- Add streaming JSON/NDJSON ingestion or a chunked binary container for captures beyond the current 32 MiB UTF-8 `.nlsession` import limit.
- Evaluate IndexedDB or an embedded desktop store for indexed frame and metric access.
- Bound timeline downsampling, memory growth, marker lookup, and evidence generation for multi-million-record sessions.
- Add cancellation and progress reporting for long imports and exports.

Exit criteria: large sessions remain responsive, cancellable, and deterministic under documented memory and latency budgets.

## Transport evidence and authenticity

- Add operating-system UDP drop counters on host and runtime combinations that expose a trustworthy capture-scoped value, with an explicit adapter and observation source for every platform.
- Distinguish captured payload bytes from measured or estimated IP, UDP, and link-layer wire bytes without presenting estimates as observations.
- Evaluate optional signing or trusted-channel anchoring for bridge journals, session files, release identity, and bundle identities.
- Preserve the current boundary clearly: checksums prove internal consistency, not author, source-channel, or build-environment authenticity.

Exit criteria: supported host adapters can add independently sourced platform counters and optional authenticity evidence without weakening the explicit unavailable state on other platforms.

## Assistive-technology and hardware certification

- Run and record structured VoiceOver reviews with packaged Safari on macOS and iOS or iPadOS.
- Run and record NVDA reviews with packaged Firefox and Chromium-based browsers on Windows.
- Add JAWS coverage when a licensed Windows test environment is available.
- Verify native `200%` browser zoom with operating-system scaling across the packaged browser matrix, beyond the current automated CSS-viewport proxy.
- Exercise physical Web Serial device selection, disconnect, failure recovery, and permission behavior with representative adapters and drivers.

Exit criteria: [ACCESSIBILITY.md](ACCESSIBILITY.md) records reproducible manual results for the supported browser, operating-system, screen-reader, zoom, and Web Serial hardware combinations without broadening claims beyond tested evidence.

## Moonshot: Community protocol workbench

- Let operators and protocol engineers build, validate, and publish decoder packs with sample captures, expected decoded fields, diagnostics, and evidence-bundle fixtures.
- Add a local schema authoring and replay comparison workspace so a contributor can see how a decoder revision changes packets, diagnostics, timelines, and bundle output.
- Support a curated registry of community protocol packs without making NarrowsLink dependent on a hosted service.
- Make protocol packs portable enough for labs, field teams, educators, and hobby communities to exchange reproducible telemetry examples.
- Publish an example protocol pack that can be used as a teaching fixture, regression suite, and contribution template.

Exit criteria: a new telemetry community can bring a protocol, fixtures, and expected behavior into NarrowsLink without forking the application.

## Moonshot: Incident evidence exchange

- Extend the local receiver from one bundle to a multi-bundle case file with immutable citations, separately owned findings, and an explicit chain of verification.
- Add optional signed manifests, public-key identity, or transparency-log integration for teams that need stronger provenance than local checksums.
- Explore redaction and minimization tools that preserve verification while stripping sensitive coordinates, identifiers, or operator notes.
- Export concise receiver findings that cite exact bundle identities and ranges while keeping the received archives unchanged.
- Define interoperable machine-readable citations so issue trackers, test reports, vendors, and research records can point to the same verified evidence.

Exit criteria: NarrowsLink becomes a practical handoff format for telemetry incidents, not only a local review tool.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
