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

## Next milestone: Transport evidence and authenticity

Strengthen the claims NarrowsLink can make about where loss occurred and who or what produced an evidence artifact without weakening its explicit unknown and unavailable states.

Planned work:

- Add operating-system UDP drop counters on host and runtime combinations that expose a trustworthy capture-scoped value, with an explicit adapter and observation source for every platform.
- Distinguish observed payload bytes from measured or estimated IP, UDP, radio, and link-layer wire bytes without presenting an estimate as an observation.
- Define optional signing or trusted-channel anchoring for bridge journals, session files, release identity, decoder packs, and bundle identities.
- Preserve the current boundary clearly: checksums prove internal consistency, not author, source channel, capture hardware, or build-environment authenticity.

Immediate next moves:

- Survey macOS, Linux, and Windows socket-counter APIs and prove which values can be scoped to one NarrowsLink capture instead of a host, interface, or process lifetime.
- Write the platform-adapter contract before implementation: observation source, scope, units, sampling boundaries, unavailable reason, and reconciliation rules must be explicit.
- Separate payload, UDP/IP overhead, radio framing, and link-layer estimates in the evidence schema; require a provenance method and confidence class for every non-observed value.
- Produce a signing threat model and key-lifecycle decision covering local keys, team keys, revocation, clock assumptions, offline receipt, and the separately trusted channel needed to establish identity.
- Add synthetic counter-mismatch and signature-tampering fixtures plus one real platform adapter acceptance case without changing evidence semantics on unsupported hosts.

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
- Add local schema authoring and decoder-revision migration tools that use comparison findings to show how a proposed pack changes packets, diagnostics, timelines, and bundle output.
- Support a curated registry of community protocol packs without making NarrowsLink dependent on a hosted service.
- Make protocol packs portable enough for labs, field teams, educators, and hobby communities to exchange reproducible telemetry examples.
- Publish an example protocol pack that can be used as a teaching fixture, regression suite, and contribution template.

Exit criteria: a new telemetry community can bring a protocol, fixtures, and expected behavior into NarrowsLink without forking the application.

## Moonshot: Incident evidence exchange

- Extend the local receiver from one bundle to a multi-bundle case file with immutable citations, separately owned findings, and an explicit chain of verification.
- Add optional signed manifests, public-key identity, or transparency-log integration for teams that need stronger provenance than local checksums.
- Explore redaction and minimization tools that preserve verification while stripping sensitive coordinates, identifiers, or operator notes.
- Import and validate portable comparison findings inside the case file while requiring the exact cited source artifacts for reproduction.
- Define interoperable machine-readable citations so issue trackers, test reports, vendors, and research records can point to the same verified evidence.

Exit criteria: NarrowsLink becomes a practical handoff format for telemetry incidents, not only a local review tool.

## Product boundary

Cloud storage, accounts, collaboration, and hosted ingestion are not current commitments. The default posture remains local-first, inspectable, and portable; any networked service should be optional and should not become necessary for capture, replay, diagnosis, or evidence export.
