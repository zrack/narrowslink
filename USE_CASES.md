# NarrowsLink use-case log

This is the canonical catalog of operator outcomes NarrowsLink currently supports. It is not a chronological project record: completed product changes belong in [CHANGELOG.md](CHANGELOG.md), and unsupported future outcomes belong in [ROADMAP.md](ROADMAP.md).

## Status model

- **Supported:** the current application provides the complete workflow and the cited implementation or automated coverage exercises its critical path.
- **Supported with constraints:** the workflow is complete within the limits stated in the entry.

Use-case IDs are permanent. Update an entry when its current workflow, support level, constraints, or evidence changes; record the notable change separately under `CHANGELOG.md` → `[Unreleased]`.

## Current use cases

| ID | Use case | Primary actor | Status | Primary output |
| --- | --- | --- | --- | --- |
| UC-001 | Record live field telemetry | Field or test operator | Supported with constraints | Version 2 `.nlsession` |
| UC-002 | Investigate a recorded telemetry fault | Mission or reliability engineer | Supported with constraints | Exact operator-authored incident range |
| UC-003 | Audit capture-path integrity | Capture engineer or forensic reviewer | Supported with constraints | Integrity assessment and transport evidence |
| UC-004 | Run decoder and session regressions | Protocol or application engineer | Supported with constraints | Repeatable decoded and diagnostic results |
| UC-005 | Hand off a verifiable incident bundle | Operator and receiving engineer | Supported with constraints | `.nlb` archive and local verification report |

## UC-001 — Record live field telemetry

**Actor:** Field or test operator

**Outcome:** Preserve live telemetry through an identified decoder pack as an immutable local session that can immediately enter the normal replay and investigation workflow and be reopened with the same interpretation from the local session library.

**Workflow:**

1. Start NarrowsLink, choose the bundled NSL-01 or NMEA 0183 pack or load a local bounded pack, then select managed UDP or Web Serial capture and configure the source.
2. NarrowsLink validates pack identity, runtime compatibility, schema, and conformance fixtures before recording raw datagrams or assembled serial records with byte counts, monotonic offsets, malformed input, UDP remote endpoints and bridge-journal events, or the browser-exposed serial device identity and negotiated settings.
3. Stop the source with **Stop, save & replay**.
4. Save the downloaded version 2 `.nlsession`, continue into replay with the validated finalized session, and retain the canonical session in the local library when IndexedDB succeeds.

**Radio transport capture topologies:**

NarrowsLink starts where telemetry bytes are available to the laptop as UDP datagrams or serial bytes. It is not an RF receiver, demodulator, passive packet sniffer, or transparent man-in-the-middle. A radio, modem, base station, ground-control station, network, or tap must deliver a readable stream to the NarrowsLink machine.

| Option | Topology | What NarrowsLink observes | Test path |
| --- | --- | --- | --- |
| 1 | USB serial radio connected to the laptop | The radio terminates the RF link and exposes telemetry bytes through a browser-selected serial device. NarrowsLink applies the selected pack's bounded serial framing, records serial reads and retained bytes, preserves device identity when exposed and negotiated settings, and retains malformed input plus disconnect or read-failure evidence. | Use a Chromium browser, select the matching decoder pack and **Serial port**, choose the USB serial radio, confirm **Serial state: open**, send known traffic, stop with **Stop, save & replay**, and verify retained records plus decoded or diagnostic output. |
| 2 | Radio or base station outputs UDP to the laptop | The external receiver terminates the RF link and forwards payloads as UDP datagrams to the NarrowsLink bridge. NarrowsLink records datagrams, byte counts, remote endpoint attribution, bridge journal entries, retained records, and capture-path diagnostics. | Start UDP capture on a known bind host and port, configure the base station to send to that exact laptop address and port, confirm datagram and retained-record counters advance, stop with **Stop, save & replay**, then replay and export a small evidence bundle. |
| 3 | Ground-control software forwards a UDP copy | Another application remains the primary receiver, and NarrowsLink receives a duplicated stream. NarrowsLink can preserve and verify the copy it received, but it cannot prove losses that happened before the copy point unless the forwarded payload or side channel carries those counters. | Configure the ground-control station or a small proxy to tee the telemetry to NarrowsLink's UDP address, run the normal UDP capture path, and compare NarrowsLink counters with the upstream tool's send or receive counters when available. |
| 4 | Network multicast observer | The sender publishes UDP to a multicast group and port; NarrowsLink joins that group on the selected interface. This is an IP-network observer pattern, not passive RF capture. NarrowsLink records multicast bind configuration, datagrams, remote endpoints, bridge journal evidence, and retained records. | Select the matching decoder pack, start UDP capture with a multicast group and matching bind/interface family, send known datagrams to the group and port, confirm NarrowsLink receives them without being the sender's only destination, then stop, replay, and verify provenance. |

For multicast, the sender addresses one UDP datagram stream to a multicast group such as `239.42.91.4:9104` instead of one specific host. Receivers that join the group on the relevant network interface can receive the stream at the same time. This is useful when a base station, ground-control tool, and NarrowsLink all need the same telemetry without configuring separate unicast destinations. It still depends on network equipment, operating-system multicast support, firewall rules, interface selection, and matching IPv4 or IPv6 family between bind address and multicast group.

**Current constraints:** The tagged v0.1.0 package predates decoder packs; the current repository build requires Node.js 20.19 or newer and a local browser. `narrowslink serve` gives the browser a same-origin relay to the managed loopback bridge and keeps its bearer credential internal, without asking the operator to transfer it; source-development mode retains a separate manual bearer-token bridge. Serial capture requires a browser with Web Serial support and a secure context such as `localhost` or `127.0.0.1`. The cross-browser automated serial gate injects the public browser API; it proves the complete application path but does not certify native device choosers, USB drivers, operating-system disconnect behavior, or physical adapters. Packs are limited to supported bounded runtimes; arbitrary JavaScript and automatic protocol detection are not accepted. NMEA UDP requires one sentence per datagram, while serial NMEA uses line-feed boundaries. Captures remain within the serialized-file, record-count, duration, and browser-storage limits. If IndexedDB, Web Crypto, or the available quota prevents library persistence, the downloaded file and active replay remain usable, but NarrowsLink reports that the session was not saved in the library.

**Implementation evidence:** [decoder-pack contract](src/domain/decoder-pack.ts), [conformance runner](src/domain/decoder-conformance.ts), [capture dialog](src/capture/CaptureDialog.tsx), [bounded recorder](src/capture/recorder.ts), [runtime-selected serial assembly](src/capture/serial-assembler.ts), [UDP client](src/capture/udp-bridge.ts), [Web Serial adapter](src/capture/web-serial.ts), [durable session library](src/storage/session-library.ts), [decoder-pack and persistence tests](src/domain/decoder-pack.test.ts), [capture-pipeline tests](src/capture/capture-pipeline.test.ts), the [cross-browser real-UDP NSL-01 and NMEA capture gate](tests/e2e/capture-to-evidence.spec.ts), the [cross-browser simulated-serial capture-to-evidence gate](tests/e2e/serial-capture-to-evidence.spec.ts), and [browser storage/failure recovery](tests/e2e/storage-failures.spec.ts).

## UC-002 — Investigate a recorded telemetry fault

**Actor:** Mission or reliability engineer

**Outcome:** Correlate link behavior, packet cadence, decoder state, diagnostics, markers, and decoded signals around one precisely bounded event.

**Workflow:**

1. Load the bundled replay, choose a validated local session, or reopen a saved session from the Sessions rail.
2. Seek or play the recording on the shared monotonic replay clock.
3. Select a preset or create an operator-authored half-open range around the event.
4. Refine the exact microsecond boundaries and inspect the projected narrative, details, statistics, diagnostics, and decoded values.
5. Add markers and a session note without modifying the source records; they persist locally by session identity when browser storage is available and are restored when the same saved content is reopened.

**Current constraints:** Active-session processing occurs in browser memory. Saved session documents use IndexedDB, while markers, notes, and authored ranges use separate per-session local storage; either store can be unavailable or reject a write. Exact duplicate session content shares one SHA-256 library identity and retains its original saved date. Removing a saved replay attempts to clear both its library document and separate operator workspace; the active in-memory replay stays open, exported files are unaffected, and a persistent warning identifies any residual workspace that could not be cleared. NarrowsLink displays one active replay and does not provide automatic comparison between separate captures.

**Implementation evidence:** [session projection](src/domain/session.ts), [replay clock](src/replay/ReplayClock.ts), [timeline helpers](src/lib/telemetry.ts), [durable session library](src/storage/session-library.ts), [session-library tests](src/storage/session-library.test.ts), [workspace persistence](src/storage/session-storage.ts), [browser replay and library coverage](tests/e2e/replay-library.spec.ts), [browser storage/failure recovery](tests/e2e/storage-failures.spec.ts), and [keyboard/accessibility coverage](tests/e2e/accessibility.spec.ts).

## UC-003 — Audit capture-path integrity

**Actor:** Capture engineer or forensic reviewer

**Outcome:** Determine what NarrowsLink actually observed about the collection path without misclassifying capture failures as source, link, or decoder failures.

**Workflow:**

1. For a version 2 session, review the workspace integrity summary, structured Provenance inspector, and capture-path diagnostics; legacy version 1 sessions have no receipt or provenance and are normalized to an unknown assessment.
2. Inspect the saved `.nlsession` or exported `transport/integrity-receipt.json`, `transport/events.json`, `transport/provenance.json`, and `transport/journal.json` when the exact evidence basis, counters, endpoint or device attribution, issue codes, and structured lifecycle entries are required.
3. Review immutable transport evidence for UDP bridge event-stream sequence discontinuities, counter mismatches, bridge or event-stream errors, recorder limits, serial failures, disconnects, and shutdown disposition.
4. Correlate `capture-path` diagnostics with the selected incident while keeping link, decoder, and unattributed evidence domains distinct.
5. Reconcile retained totals with transport-reported totals, endpoint-attribution totals, and the capture-scoped bridge journal when those observations are available.

**Current constraints:** A version 2 receipt and provenance document can attest only to observations exposed by the local adapters. Node's portable UDP API does not expose a capture-scoped operating-system drop counter, so current bridge journals preserve that value as explicitly unavailable rather than claiming zero. Captured and reported byte totals describe retained payload bytes, not measured link-layer traffic. Earlier version 2 sessions that predate provenance remain valid and are not rewritten; their provenance inspector and exported provenance artifacts state that the evidence is unavailable.

**Implementation evidence:** [integrity types](src/domain/types.ts), [capture finalization](src/capture/recorder.ts), [session validation and diagnostics](src/domain/session.ts), [session integrity tests](src/domain/session.test.ts), and the [cross-browser capture-to-evidence gate](tests/e2e/capture-to-evidence.spec.ts).

## UC-004 — Run decoder and session regressions

**Actor:** Protocol or application engineer

**Outcome:** Exercise a stable telemetry corpus before and after a decoder or session-pipeline change and detect unintended changes in parsing, diagnostics, recovery, range semantics, or evidence generation.

**Workflow:**

1. Regenerate or load the deterministic Harbor relay fixture, or load a sealed decoder pack with its own records and expected results.
2. Validate pack identity, runtime and schema compatibility, then run every fixture through the production session, decoder, diagnostics, and replay pipeline.
3. Exercise the NSL-01 families and malformed binary cases plus NMEA GGA, RMC, HDT, XOR-8 checksum failure, serial line assembly, and partial-tail retention.
4. Seal and validate contributor packs with `narrowslink decoder seal` and `narrowslink decoder validate`, then compare domain assertions rather than decorative chart coordinates.

**Current constraints:** This is a repeatable NarrowsLink development and QA workflow, not a firmware harness or built-in side-by-side comparison screen. Packs may use only the supported bounded runtime allowlist. The NMEA runtime supports declarative sentence schemas; a fundamentally different protocol still requires a reviewed runtime implementation.

**Implementation evidence:** [fixture generator](scripts/generate-demo-session.mjs), [decoder registry and runtimes](src/domain/decoder.ts), [pack contract](src/domain/decoder-pack.ts), [conformance runner](src/domain/decoder-conformance.ts), [pack CLI](scripts/narrowslink.ts), [decoder-pack tests](src/domain/decoder-pack.test.ts), [pack CLI tests](scripts/narrowslink-decoder.test.ts), [fixture integration tests](src/domain/fixture.integration.test.ts), [session tests](src/domain/session.test.ts), and the [real NMEA UDP handoff gate](tests/e2e/capture-to-evidence.spec.ts).

## UC-005 — Hand off a verifiable incident bundle

**Actor:** Operator and receiving engineer

**Outcome:** Package one exact incident range with enough local evidence for another engineer to inspect and verify the received archive through a production, offline receiver workflow.

**Workflow:**

1. Select the operator-authored half-open incident range.
2. Add the relevant markers and notes, choose optional artifact groups, retain the decoder schema when the receiver must reproduce a non-built-in pack, and keep the mandatory transport events, provenance, bridge journal, and capture-integrity receipt.
3. Generate and download the `.nlb` ZIP archive.
4. On the receiving machine, install the same self-contained release package and run `narrowslink verify incident.nlb` or add `--json` for the stable machine-readable report.
5. Review the internal-integrity, capture-evidence, provenance-evidence, decoder-pack conformance and replay result, warnings, exact selection, artifact list, and whole-bundle SHA-256; compare the bundle and pack identities through a separately trusted channel when authenticity matters.

**Current constraints:** The receiver CLI accepts version 3 `.nlb` bundles and treats their ZIP structure and contents as bounded, untrusted input. When the exact pack is available, it validates pack identity and fixtures and reproduces decoded rows from selected raw records. Excluding the schema artifact can prevent replay-checking a local pack and produces an explicit warning. Exit status `0` establishes internal consistency, not complete capture evidence: a valid bundle can truthfully report `incomplete` or `unknown` capture or provenance evidence. Version 3 bundles and decoder packs are unsigned, so the verifier reports authenticity as not established and cannot prove who created them or whether the originating build was trustworthy. Raw telemetry, coordinates, identifiers, and notes may be sensitive and must be reviewed before sharing.

**Implementation evidence:** [shared evidence contract](src/domain/evidence-contract.ts), [bundle builder](src/domain/bundle.ts), [production receiver verifier](verifier/evidence-verifier.ts), [bounded ZIP reader](verifier/evidence-zip.ts), [receiver and pack CLI](scripts/narrowslink.ts), [bundle tests](src/domain/bundle.test.ts), [receiver pack replay tests](verifier/evidence-verifier.test.ts), [session workspace persistence](src/storage/session-storage.ts), the [cross-browser NSL-01 and NMEA capture-to-evidence gate](tests/e2e/capture-to-evidence.spec.ts), its [production-verifier adapter](tests/e2e/support/archive.ts), and the [artifact-local receiver gate](tests/release/).

## Maintaining this log

1. Assign the next `UC-###` identifier and never renumber an existing use case.
2. Describe an operator goal and observable outcome, not a component or implementation task.
3. Cite the current implementation and automated evidence that justify the stated support level.
4. Keep unsupported outcomes in the roadmap or an issue until an end-to-end workflow exists.
5. When support or constraints change, update the existing entry and add the notable change to the changelog; do not append historical notes here.
