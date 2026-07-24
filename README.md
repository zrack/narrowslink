# NarrowsLink

NarrowsLink records live UDP or serial telemetry, turns the capture into an immutable local replay, and provides a synchronized incident-review workspace. Every new capture also carries durable transport anomalies, explicit endpoint or device provenance, a capture-scoped bridge journal where applicable, and a terminal integrity receipt. One playhead based on integer microsecond offsets drives link health, packet families, decoder state, diagnostics, markers, and decoded signals; the selected interval can then be exported as a reproducible evidence bundle.

![NarrowsLink mission-timeline session review workspace](docs/assets/narrowslink-dashboard.png)

The application is local-first. The v0.1 distribution starts the production workspace and authenticated UDP bridge together on loopback; the browser uses a same-origin application relay, while the bridge credential remains internal to the managed process and never requires operator copying. Its UDP socket binds the operator-selected interface. Serial ingest uses the browser's Web Serial connection. Capture, saved sessions, replay, annotations, evidence generation, and receiver verification stay on the operator's or receiving engineer's machine. NarrowsLink has no telemetry upload, cloud account, or hosted dependency.

## Start here

- Follow the [user guide](USER_GUIDE.md) for installation, live capture, replay, incident authoring, evidence handoff, upgrades, removal, and troubleshooting.
- Download the current package and release evidence from [NarrowsLink v0.1.0](https://github.com/zrack/narrowslink/releases/tag/v0.1.0).
- Review the [use-case log](USE_CASES.md) for supported operator outcomes and current constraints.
- Use [SUPPORT.md](SUPPORT.md) to prepare a reproducible support request without disclosing sensitive telemetry.
- Contributors should start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

NarrowsLink v0.1.0 is a self-contained package with zero runtime npm dependencies. It contains the production UI, managed UDP bridge, deterministic Harbor relay fixture, and receiver verifier. It requires Node.js 20.19 or newer, but it does not require a repository checkout, Vite, or project dependencies.

Download these four assets from the [v0.1.0 GitHub Release](https://github.com/zrack/narrowslink/releases/tag/v0.1.0):

- `narrowslink-0.1.0.tgz`
- `narrowslink-0.1.0.release.json`
- `narrowslink-0.1.0.cdx.json`
- `SHA256SUMS`

On macOS, verify the assets, install the package without lifecycle scripts, confirm its identity, and start the application:

```bash
shasum -a 256 -c SHA256SUMS
npm install --global ./narrowslink-0.1.0.tgz --ignore-scripts
narrowslink version --json
narrowslink serve
```

On GNU/Linux, use `sha256sum -c SHA256SUMS` for the checksum step.

`narrowslink serve` opens the production application at `http://127.0.0.1:47890/` and starts its authenticated bridge in the same managed process. The UI discovers the bridge and UDP defaults automatically; no token, manual URL, second terminal, source tree, or external network service is required. Press `Ctrl+C` in the serving terminal to stop both the application server and bridge cleanly.

The external release manifest identifies the exact version, commit, source tree, build epoch, toolchain, lockfile, and packaged-file hashes. The CycloneDX SBOM describes the shipped application, and `SHA256SUMS` covers the package, manifest, and SBOM. These same-channel checks establish byte consistency, not independent publisher or build-environment authenticity.

Continue with the [guided first run](USER_GUIDE.md#first-run-with-the-bundled-replay).

## Current capabilities

- Capture unicast or multicast UDP datagrams through the managed authenticated local bridge, or record NSL-01 serial input directly through Web Serial. Stopping a source downloads a versioned `.nlsession`, opens the validated finalized capture for replay, and attempts to retain it in the local session library.
- Load the bundled demonstration, reopen a saved session, or choose a local version 1 or 2 session. Every source travels through the same validation, decoding, diagnostics, incident, and export pipeline; a validated local file is also retained in the library when browser storage succeeds. Legacy v1 evidence remains unchanged and carries an explicit unknown capture-integrity assessment.
- Keep multiple validated sessions in an IndexedDB-backed local library. The Sessions rail lists real title, time, duration, and integrity metadata; exact duplicate content remains one entry, and every reopen rechecks the stored SHA-256 identity, canonical session bytes, validation, and decoding before replacing the active replay. Removing an entry also clears its separately stored markers, note, and authored ranges when browser storage permits; an active replay stays open until it is replaced.
- Decode the NSL-01 envelope, CRC-16/CCITT-FALSE integrity, and Heartbeat, Power, Attitude, Position, and Thermal families while retaining malformed, partial, checksum-failed, and unknown frames as inspectable diagnostics.
- Correlate connection health, packet cadence, decoder state, diagnostics, markers, and decoded signals on one monotonic microsecond replay clock.
- Create, rename, classify, resize, and precisely edit operator-owned half-open incident ranges; markers, ranges, and notes persist per session when browser storage is available, without mutating the source replay.
- Export the selected range as a local `.nlb` archive with an exact manifest, mandatory transport events, provenance, bridge journal, and capture-integrity receipt, and a SHA-256 checksum for every emitted artifact.
- Verify a received version 3 `.nlb` locally with the production receiver CLI, which rejects unsafe or inconsistent archives and reports internal integrity, capture and provenance evidence status, bundle identity, and the separate unsigned-authenticity boundary.

## Operator use cases

NarrowsLink currently supports five end-to-end operator outcomes:

| ID | Use case | Primary output |
| --- | --- | --- |
| UC-001 | Record live field telemetry | Version 2 `.nlsession` |
| UC-002 | Investigate a recorded telemetry fault | Exact operator-authored incident range |
| UC-003 | Audit capture-path integrity | Integrity assessment and transport evidence |
| UC-004 | Run decoder and session regressions | Repeatable decoded and diagnostic results |
| UC-005 | Hand off a verifiable incident bundle | `.nlb` archive and local verification report |

See the canonical [use-case log](USE_CASES.md) for actors, supported workflows, current constraints, and implementation evidence.

## Operator workflow

NarrowsLink opens the bundled **Harbor relay downlink** replay automatically. An operator can replace it with a validated local file, reopen a saved session, or record live UDP or serial traffic. The normal capture-to-evidence path is:

1. Open or capture a session and select a replay preset or operator-authored incident range.
2. Correlate link health, packet cadence, decoder state, diagnostics, decoded signals, and transport provenance on the shared replay clock.
3. Add local markers and a session note without changing the captured records.
4. Choose optional evidence groups; the transport event log, provenance, bridge journal, and capture-integrity receipt remain mandatory.
5. Build the `.nlb` archive and have the receiver run `narrowslink verify`.

The [user guide](USER_GUIDE.md) provides the full procedure, UI labels, recovery steps, and authenticity boundaries.

## Local data continuity

Saved sessions use IndexedDB at the stable `http://127.0.0.1:47890` browser origin. Markers, notes, and authored ranges use separate storage tied to the same session identity and origin. Upgrade on the same `127.0.0.1` application port and browser profile to retain access to that library. Changing the application port or browser profile selects different browser storage and can make the prior library appear absent.

Uninstalling the package does not delete the local session library, operator workspace, downloaded `.nlsession` files, or exported `.nlb` bundles. Follow the [upgrade and removal guide](USER_GUIDE.md#upgrade-narrowslink) before replacing the package or intentionally clearing site data.

## Live capture

![NarrowsLink live UDP capture setup](docs/design/live-capture-setup.jpg)

The installed release offers **UDP bridge** and **Serial port** from the **Live capture** dialog.

For UDP, the managed process keeps its bridge credential internal and exposes bind, port, and optional multicast settings in the dialog. Command-line UDP flags populate dialog defaults; no socket starts until the operator selects **Start UDP capture**. The chosen bind controls which local interface receives telemetry, so `0.0.0.0` should be used only when listening on every local IPv4 interface is intentional.

For serial, the operator selects port settings and then chooses the device through the browser's native Web Serial prompt. Web Serial requires a supporting Chromium browser and a secure loopback context. Automated coverage exercises the application path with an injected standards-based serial API; physical adapters, drivers, native chooser behavior, and operating-system disconnect handling remain a manual boundary.

Stopping either source with **Stop, save & replay** downloads a version 2 `.nlsession`, opens the validated finalized capture, and attempts to retain it in the local session library. Follow the [UDP procedure](USER_GUIDE.md#record-live-udp) or [serial procedure](USER_GUIDE.md#record-live-serial-telemetry) before connecting a field source.

![NarrowsLink replaying and investigating a captured UDP burst](docs/design/live-capture-replay.jpg)

## Development

Source development, fixture regeneration, test commands, and the manual bearer-token bridge belong to [CONTRIBUTING.md](CONTRIBUTING.md). The complete `npm run check` gate covers TypeScript, unit and integration tests, production builds, source browser workflows, deterministic release packaging, and the unpacked-distribution capture-to-verification workflow in Chromium, Firefox, and WebKit.

## Browser capability and test matrix

This matrix separates automated browser-engine evidence from hardware and assistive-technology certification. A Playwright WebKit pass is engine-level evidence, not a claim that every Safari, operating-system, or device combination has been manually certified.

| Workflow | Playwright Chromium | Playwright Firefox | Playwright WebKit | Current verification |
| --- | --- | --- | --- | --- |
| Replay, local import, saved-session library, timeline review, markers, notes, and `.nlb` export | Automated | Automated | Automated | Invalid-file recovery, validated import, exact-content deduplication, playback/rate controls, per-session workspace restoration, guarded removal, and storage failure states |
| Live UDP through the local bridge | Automated | Automated | Automated | A real ephemeral loopback bridge records fixture datagrams, stops with reconciled v2 integrity, reimports the `.nlsession`, replays it, and completes the exact-range evidence workflow |
| Simulated Web Serial capture-to-evidence | Automated | Automated | Automated | An injected standards-based serial stream exercises device selection, fragmented reads, NSL-01 assembly, partial-byte retention, reconciled v2 integrity, durable reopen, replay, exact-range export, and production receiver verification |
| Independent `.nlb` verification | Automated | Automated | Automated | Browser downloads are passed to the production receiver verifier; bounded ZIP structure, canonical paths, half-open boundaries, required transport evidence, artifact schemas, record counts, semantic reconciliation, manifest hashes, and `SHA256SUMS` are verified |
| Keyboard, dialogs, and responsive access | Automated | Automated | Automated | axe rules tagged WCAG A/AA, critical focus handoffs, `960`, `640`, and `390` CSS-pixel reflow, keyboard scrollers, and forced-color cues run in all three engines |
| Physical Web Serial hardware | Manual boundary | Manual boundary | Manual boundary | The application path is automated with an injected API, but native device choosers, transient activation, USB drivers, operating-system disconnect behavior, and packaged-browser combinations are not certified |

See [ACCESSIBILITY.md](ACCESSIBILITY.md) for the tested interaction matrix, claim boundary, and remaining manual screen-reader work.

## Bundled replay

`public/fixtures/harbor-relay-session.json` is a deterministic synthetic session designed to exercise the production pipeline:

- 18,402 source records over 8,435 seconds (2 h 20 m 35 s).
- UTC start at `2026-07-16T04:38:12.000Z`, displayed in `America/Los_Angeles`.
- Historical source metadata for multicast UDP `239.42.91.4:9104`; the app is replaying a file, not opening that socket.
- NSL-01 decoder revision `v1.3.7` with all five built-in packet families.
- Three incident presets covering a link fade and decoder resync, an interference burst, and a clean schema-revision transition.
- Varied deterministic packet cadence, a sustained fade and recovery, intentional missing-frame episodes, CRC failures, missing sync words, and truncated frames for forensic and error-state testing.

Fixture regeneration and review requirements are documented in [CONTRIBUTING.md](CONTRIBUTING.md#regenerating-the-fixture).

## Session file format

The current importer accepts JSON files with `.json` or `.nlsession` extensions using `narrowslink/session` format version 1 or 2. Version 1 remains a strict, unchanged legacy contract. New live recordings use version 2:

```text
Session
├── UTC start, display time zone, and duration in microseconds
├── one source descriptor and one decoder descriptor
├── immutable source records
│   ├── integer offsetUs
│   ├── captured frame bytes as hexadecimal
│   ├── transport provenance and byte counts
│   └── optional RSSI/SNR provenance
├── immutable transport events (v2)
│   ├── point, interval, or session scope
│   ├── UDP, serial, backpressure, limit, or shutdown evidence
│   └── stable identity, severity, and structured counters or codes
├── terminal capture-integrity receipt (v2)
│   ├── verified, incomplete, or unknown assessment
│   ├── stop disposition and event-log completeness
│   └── observed, transport-reported, and retained totals
├── structured transport provenance (new v2 captures)
│   ├── UDP capture identity, bind and multicast configuration
│   ├── per-record remote endpoint attribution and bounded bridge journal
│   ├── serial device identifiers and negotiated settings
│   └── explicit unavailable observations and provenance issue codes
└── zero or more incident presets using [startUs, endUs)
```

Records must be ordered by nondecreasing `offsetUs`, reference the declared source, fit inside `durationUs`, and declare byte counts that match their hexadecimal payload. Version 2 additionally requires ordered, uniquely identified transport events and a receipt whose retained totals exactly match the records. New captures also preserve a validated provenance document: UDP endpoint-attribution totals and journal counters must reconcile with immutable records and the receipt, while serial device and negotiated-setting values must remain bounded and explicit. A verified UDP receipt requires bridge, browser, recorder, journal, and endpoint parity; a verified serial receipt requires clean stop, retained-byte parity, and explicit serial provenance. Format validation is implemented in `src/domain/types.ts` and `src/domain/session.ts`.

Receipt assessment bases state what was actually observed. `udp-bridge-reconciled` includes terminal bridge counters; `udp-browser-observed` leaves unavailable bridge totals null and cannot be verified; `web-serial-observed` reconciles observed serial bytes; and `recorder-only` records that no adapter finalization evidence was supplied. UDP and serial counter disagreements require their own issue code and exact counter evidence. When a bounded event log is complete, every transport issue must have a matching immutable event. If its evidence budget is exhausted, the receipt explicitly marks the log incomplete while preserving the known issue codes and terminal counters.

Imported v1 evidence is not rewritten. Replay normalizes it to an in-memory `unknown · legacy replay` assessment because the original file has no durable capture receipt. Earlier valid v2 sessions without the optional provenance field also remain unchanged; the workspace and bundle artifacts report provenance as unavailable instead of inferring it from retained records.

![NarrowsLink replaying a durable UDP capture-path anomaly with incomplete integrity](docs/design/implementation-capture-integrity.png)

The v1 binary envelope is little-endian after its `A55A` sync word and includes protocol version, family ID, sequence, payload length, device time, payload, and CRC-16/CCITT-FALSE. The canonical built-in schema in `src/domain/decoder.ts` describes every envelope and payload field, including byte offsets, types, scales, units, enums, and bounds. Its descriptor carries the SHA-256 digest of recursively key-sorted canonical schema JSON; a conformance test prevents schema and identity drift. Runtime schema import is not implemented yet.

## Evidence bundle format

An `.nlb` file is an ordinary ZIP archive generated entirely in the browser. Depending on the inclusion controls, it contains:

```text
manifest.json
SHA256SUMS
transport/events.json
transport/provenance.json
transport/journal.json
transport/integrity-receipt.json
raw/source-records.ndjson
decoded/packets.csv
diagnostics/diagnostics.json
diagnostics/diagnostics.csv
markers/markers.json
notes/notes.json
schema/schema.json
```

Range-scoped events, records, decoded packets, diagnostics, markers, and notes are filtered to the selected half-open interval. Point transport events at `startUs` are included and events at `endUs` are excluded; overlapping intervals and session-scoped integrity events are included. The mandatory `transport/integrity-receipt.json`, `transport/provenance.json`, and `transport/journal.json` instead preserve whole-session evidence, including explicit unavailable states for legacy or pre-provenance input. All four transport artifacts are mandatory even when every optional evidence group is excluded.

`manifest.json` records the session and decoder identity, declared session duration, capture-integrity receipt, provenance availability and summary, exact selection, actual inclusions, media types, byte sizes, record counts, and artifact hashes. Those values describe the generated bytes, unlike the selected-group and size estimates shown before generation. `decoded/packets.csv` retains complete integrity JSON for forensic failures, and `schema/schema.json` includes the reproducible byte-level decoder definition. `SHA256SUMS` covers the manifest and each included evidence artifact.

### Verify a bundle independently

After installing the v0.1.0 package, a receiving engineer can verify a version 3 bundle locally without a repository checkout, application server, browser workspace, or network access:

```bash
narrowslink verify path/to/incident.nlb
narrowslink verify path/to/incident.nlb --json
```

The production verifier bounds and preflights the archive before decompression, then checks canonical paths, schemas, inclusions, checksums, counts, range semantics, receipts, provenance, journals, and decoder identity. Do not extract an untrusted `.nlb` before this verification.

Exit status `0` means the archive is internally consistent. Exit `1` means it is invalid, tampered, unsafe, or unsupported. Exit `2` means command usage or local file I/O failed. A consistent bundle can still report `incomplete` or `unknown` capture evidence. Version 3 bundles are unsigned, so authenticity remains `not-established`.

Follow the [receiver procedure](USER_GUIDE.md#verify-a-received-bundle) to interpret the report and exchange the bundle identity through a separately trusted channel.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/App.tsx` | Application state and mission-timeline workspace UI |
| `src/capture/CaptureDialog.tsx` | Live-source configuration, capture lifecycle, integrity status, save, and replay handoff |
| `src/capture/recorder.ts` | Bounded immutable source-record collection and versioned session finalization |
| `src/capture/web-serial.ts` | Permission-aware Web Serial lifecycle and byte-stream reads |
| `src/capture/nsl01-serial-assembler.ts` | NSL-01 framing, noise retention, and bounded resynchronization |
| `src/capture/udp-bridge.ts` | Typed, authenticated browser client for the local UDP bridge |
| `src/data/load-session.ts` | Bundled and user-file loading, size limits, and surfaced load errors |
| `src/data/session-file.ts` | Canonical compact `.nlsession` serializer and shared 32 MiB import/export budget |
| `src/domain/types.ts` | Versioned session schema and core telemetry types |
| `src/domain/decoder.ts` | Frame envelope, CRC, built-in family decoding, and malformed-frame retention |
| `src/domain/session.ts` | Validation, metric derivation, diagnostics, incident projection, and range helpers |
| `src/replay/` | Pure monotonic replay clock and its React subscription hook |
| `src/storage/session-library.ts` | Content-addressed session-document persistence, metadata, validation, and removal in IndexedDB |
| `src/storage/session-storage.ts` | Versioned per-session operator-range, marker, and note persistence in local storage |
| `src/domain/evidence-contract.ts` | Strict version 3 evidence manifest, artifact, transport-document, path, media-type, and resource-limit contract |
| `src/domain/bundle.ts` | Range-filtered, checksummed `.nlb` evidence generation and browser download |
| `verifier/` | Bounded ZIP intake and production receiver verification of archive structure, artifact content, and cross-document semantics |
| `scripts/narrowslink.ts` | Managed `serve`, receiver `verify`, and exact build-identity commands with stable exit behavior |
| `scripts/operator-runtime.ts` | Secure static application server and coordinated bridge lifecycle for the installed release |
| `src/lib/telemetry.ts` | Timeline sampling, value lookup, and source-aligned incident view ranges |
| `src/lib/time.ts` | Time-zone-aware presentation and byte-size helpers |
| `scripts/capture-bridge.mjs` | Authenticated loopback control plane, UDP socket, multicast membership, and SSE delivery |
| `scripts/release/` | Whitelist-only deterministic package, manifest, SBOM, checksum, and reproducibility tooling |
| `scripts/send-demo-udp.mjs` | Replays checked-in fixture records as real UDP datagrams for acceptance testing |
| `scripts/generate-demo-session.mjs` | Deterministic synthetic fixture generator |
| `tests/e2e/` | Cross-browser capture-to-evidence, archive-verification, persistence, failure-recovery, accessibility, and responsive release gates |
| `tests/release/` | Unpacked-distribution UDP capture-to-evidence, artifact-local verification, and upgrade persistence gate |

Raw source records remain immutable. Frames, fields, metrics, diagnostics, incidents, and bundle artifacts are derived from those records, and the same path is used for the bundled fixture and imported files.

## Privacy and data handling

Serial capture, session-library persistence, replay parsing, marker and note persistence, and evidence generation happen locally in the browser. Validated canonical session documents and their identifying metadata are stored in IndexedDB; markers, authored ranges, and notes use separate per-session local storage. Removing a saved replay attempts to clear both stores, leaves any active in-memory replay open, and does not affect previously exported files. If the replay document is removed but workspace cleanup fails, NarrowsLink keeps a visible warning that residual operator context may remain in browser storage. UDP payloads move only from the local socket bridge to the local page. In the installed release, the browser uses a same-origin relay and the managed process authenticates to the loopback-only bridge with an internal short-lived credential that is not returned in runtime metadata, URLs, cookies, readiness output, or logs. The UDP listener itself binds exactly the interface selected by the operator. NarrowsLink has no account system, analytics service, telemetry upload, or cloud synchronization.

Local does not automatically mean safe to share. A saved replay or evidence bundle can contain raw bytes, device identifiers, coordinates, signal observations, and operator notes. Review and sanitize captures before committing them or sending them to someone else. Browser IndexedDB and local storage are convenient persistence mechanisms, not encrypted secrets stores.

## Current limits

- Live capture supports UDP and Web Serial; TCP and other transports are not implemented.
- The v0.1 package requires a compatible local Node.js runtime and browser. It bundles all NarrowsLink application code and runtime dependencies, but it is not a native installer or embedded-browser distribution.
- The serial adapter is bound to the bundled NSL-01 decoder schema, and decoder families are compiled into the application; external schemas and protocol plug-ins are not supported.
- The active session is parsed, decoded, indexed, and bundled in browser memory. The local library stores bounded whole session documents rather than streaming or indexing large captures; every entry remains subject to the 32 MiB replay limit and the browser's available storage quota, while captures also retain the 100,000-record and 24-hour schema limits.
- IndexedDB or Web Crypto can be unavailable or reject a save. NarrowsLink surfaces the failure and keeps the validated replay usable in memory instead of claiming it was saved.
- New live captures use version 2 durable transport events, per-record UDP endpoint or serial-device provenance, bridge journals where applicable, and integrity receipts. Legacy v1 and earlier pre-provenance v2 replays remain supported with explicit unknown or unavailable assessments; those earlier v2 documents may lack endpoint attribution, a bridge journal, or the internal capture identity and are not rewritten.
- The receiver CLI verifies version 3 `.nlb` bundles. It establishes internal consistency and reports the evidence NarrowsLink could observe; because bundles are unsigned, it does not establish author, source-channel, or originating-build authenticity.
- Automated coverage exercises the complete real-loopback UDP and simulated Web Serial capture-to-evidence loops in Playwright Chromium, Firefox, and WebKit and gates axe rules tagged WCAG A/AA, critical keyboard focus, responsive reflow, failure recovery, and independent archive verification. Physical Web Serial devices and manual screen-reader/browser combinations remain outside the automated release gate.

## Project documentation

| Document | Purpose |
| --- | --- |
| [USER_GUIDE.md](USER_GUIDE.md) | Step-by-step installation, capture, replay, incident, evidence handoff, upgrade, removal, and troubleshooting |
| [USE_CASES.md](USE_CASES.md) | Stable catalog of supported operator outcomes, constraints, and implementation evidence |
| [CHANGELOG.md](CHANGELOG.md) | Canonical record of notable completed changes and tagged releases |
| [ROADMAP.md](ROADMAP.md) | Planned work, constraints, and exit criteria; completed work moves to the changelog |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, engineering invariants, review expectations, and changelog policy |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Current automated accessibility evidence, keyboard contract, support boundary, and manual certification matrix |
| [design-qa.md](design-qa.md) | Current accepted visual baseline and verification evidence |
| [docs/releases/](docs/releases/) | Immutable operator-facing summaries and installation notes for each published tag |

For step-by-step operation, use the [user guide](USER_GUIDE.md). For problem reporting, see [SUPPORT.md](SUPPORT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), and review [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating in project spaces.

## License

NarrowsLink is available under the [MIT License](LICENSE).
