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

## Next milestone: Receiver workspace proof

Let a receiving engineer open a verified `.nlb` directly in NarrowsLink and continue the investigation without the original `.nlsession`, source device, capture laptop, or command line.

Planned work:

- Treat `.nlb` input as untrusted and run the production verifier before exposing any archive content to the workspace.
- Build a bounded receiver data model from only the selected raw records, decoded packets, diagnostics, annotations, transport evidence, decoder pack, and manifest carried by the bundle.
- Reconstruct the exact half-open incident range without fabricating whole-session context, missing packets, or evidence outside the archive.
- Reuse the mission-timeline investigation vocabulary where the included evidence supports it, while visibly marking unavailable lanes and whole-session context.
- Keep internal consistency, evidence completeness, and unsigned authenticity as separate claims throughout the receiver UI.
- Allow receiver-owned notes or findings to be stored separately without mutating the original bundle or presenting them as source evidence.
- Exercise an independently produced NSL-01 and NMEA bundle through verification, receiver opening, evidence inspection, reload, and failure recovery in the packaged browser matrix.

Exit criteria: a person who did not attend the test can receive one `.nlb`, verify and open it on another NarrowsLink installation, inspect the same included evidence and limitations, and continue the investigation without requesting the original session.

## Immediate next moves

- Define the receiver workspace's bounded in-memory document and its explicit unavailable states before building UI.
- Map each existing mission-timeline lane to the evidence artifacts required to render it honestly.
- Add sanitized full and minimal receiver fixtures, including a bundle whose schema or raw records were intentionally excluded.
- Design the smallest open-and-verify flow that keeps verification failure, incomplete evidence, and unsigned authenticity visible.
- Decide how separately persisted receiver notes are identified, exported, and cleared without modifying the received bytes.
- Keep the current 32 MiB session limit, unsigned bundle boundary, and physical Web Serial certification boundary visible as tracked constraints.

Exit criteria: the receiver model, artifact requirements, failure states, and end-to-end acceptance fixture are reviewable before workspace implementation begins.

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

- Define a receiver workflow where `.nlb` bundles can be compared, annotated, verified, and cited across organizations without exposing unrelated session data.
- Add optional signed manifests, public-key identity, or transparency-log integration for teams that need stronger provenance than local checksums.
- Build a focused receiver mode for non-operators: open bundle, verify integrity, inspect exact incident range, review provenance, and export a concise finding.
- Explore redaction and minimization tools that preserve verification while stripping sensitive coordinates, identifiers, or operator notes.
- Let a receiving engineer attach their own verification notes without mutating the original evidence bundle.

Exit criteria: NarrowsLink becomes a practical handoff format for telemetry incidents, not only a local review tool.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
