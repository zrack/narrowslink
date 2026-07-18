# NarrowsLink

NarrowsLink records live UDP or serial telemetry, turns the capture into an immutable local replay, and provides a synchronized incident-review workspace. Every new capture also carries durable transport anomalies, explicit endpoint or device provenance, a capture-scoped bridge journal where applicable, and a terminal integrity receipt. One playhead based on integer microsecond offsets drives link health, packet families, decoder state, diagnostics, markers, and decoded signals; the selected interval can then be exported as a reproducible evidence bundle.

![NarrowsLink mission-timeline session review workspace](docs/assets/narrowslink-dashboard.png)

The application is local-first. UDP ingest uses a local Node.js bridge whose token-protected control plane listens only on loopback; its UDP socket binds the operator-selected interface. Serial ingest uses the browser's Web Serial connection. Capture, saved sessions, replay, annotations, and evidence generation stay on the operator's machine. NarrowsLink has no telemetry upload, cloud account, or hosted dependency.

## Current capabilities

- Capture unicast or multicast UDP datagrams through the token-protected local bridge, or record NSL-01 serial input directly through Web Serial. Stopping a source downloads a versioned `.nlsession`, opens the validated finalized capture for replay, and attempts to retain it in the local session library.
- Load the bundled demonstration, reopen a saved session, or choose a local version 1 or 2 session. Every source travels through the same validation, decoding, diagnostics, incident, and export pipeline; a validated local file is also retained in the library when browser storage succeeds. Legacy v1 evidence remains unchanged and carries an explicit unknown capture-integrity assessment.
- Keep multiple validated sessions in an IndexedDB-backed local library. The Sessions rail lists real title, time, duration, and integrity metadata; exact duplicate content remains one entry, and every reopen rechecks the stored SHA-256 identity, canonical session bytes, validation, and decoding before replacing the active replay. Removing an entry also clears its separately stored markers, note, and authored ranges when browser storage permits; an active replay stays open until it is replaced.
- Decode the NSL-01 envelope, CRC-16/CCITT-FALSE integrity, and Heartbeat, Power, Attitude, Position, and Thermal families while retaining malformed, partial, checksum-failed, and unknown frames as inspectable diagnostics.
- Correlate connection health, packet cadence, decoder state, diagnostics, markers, and decoded signals on one monotonic microsecond replay clock.
- Create, rename, classify, resize, and precisely edit operator-owned half-open incident ranges; markers, ranges, and notes persist per session when browser storage is available, without mutating the source replay.
- Export the selected range as a local `.nlb` archive with an exact manifest, mandatory transport events, provenance, bridge journal, and capture-integrity receipt, and a SHA-256 checksum for every emitted artifact.

## Operator use cases

NarrowsLink currently supports five end-to-end operator outcomes:

| ID | Use case | Primary output |
| --- | --- | --- |
| UC-001 | Record live field telemetry | Version 2 `.nlsession` |
| UC-002 | Investigate a recorded telemetry fault | Exact operator-authored incident range |
| UC-003 | Audit capture-path integrity | Integrity assessment and transport evidence |
| UC-004 | Run decoder and session regressions | Repeatable decoded and diagnostic results |
| UC-005 | Hand off a verifiable incident bundle | Checksummed `.nlb` archive |

See the canonical [use-case log](USE_CASES.md) for actors, supported workflows, current constraints, and implementation evidence.

## Typical incident workflow

1. Load the bundled fixture, choose a saved session from the Sessions rail, or select **Open local replay** for a `.json` or `.nlsession` file.
2. Select a replay preset or choose **New range** to create a local incident around the playhead. A preset can be refined as a separate local copy.
3. Drag the amber start/end handles for rapid adjustment, or use the incident editor to name the range and enter exact included-start and excluded-end offsets.
4. Use **Play replay**, seeking, and rate controls to inspect the range while correlating Narrative, Details, Stats, and Provenance with decoder, diagnostic, marker, packet-family, decoded-signal, capture-integrity, endpoint or device, and evidence-domain context.
5. Use **Add marker** and the session-wide note to preserve operator context locally.
6. Choose the evidence groups to include and review the estimated archive size; this pre-build preview is not a byte-exact manifest.
7. Select **Create incident bundle** to download the verifiable `.nlb` archive for that exact operator-authored range.

## Run it locally

NarrowsLink requires Node.js 20.19 or newer and npm.

```bash
npm ci
npm run dev
```

Vite prints the local URL when the server is ready. For the full verification suite:

```bash
npx playwright install chromium firefox webkit
npm run check
```

`npm run check` runs TypeScript validation, the Vitest suite, a production build, and the Playwright release suite against Chromium, Firefox, and WebKit. CI installs the matching browser runtimes and retains traces, screenshots, and video when a browser check fails.

## Record live UDP

![NarrowsLink live UDP capture setup](docs/design/live-capture-setup.jpg)

Start the Vite app, then launch the local bridge in another terminal:

```bash
npm run dev
```

```bash
npm run capture:bridge
```

The bridge prints one JSON line containing its loopback `controlUrl` and a newly generated `token`. In NarrowsLink, choose **Live capture → UDP bridge**, paste those values, select the UDP bind host and port, and start recording. The control API listens only on `127.0.0.1`; the token prevents another local page from controlling the socket.

To exercise the complete flow without hardware, start a capture on `127.0.0.1:9104` and run:

```bash
npm run capture:demo
```

The demo sends 480 exact datagrams from the checked-in fixture. Stop the capture with **Stop, save & replay**; NarrowsLink downloads the `.nlsession`, reopens it, attempts to save it in the local session library, and selects its full captured interval for investigation and evidence export.

![NarrowsLink replaying and investigating a captured UDP burst](docs/design/live-capture-replay.jpg)

For multicast, bind an address in the same IP family and provide the group in the dialog. Bridge defaults can be supplied on the command line, but the dialog's bind host and port are explicit per-capture values; mirror `0.0.0.0` and `9104` there when using this example. `0.0.0.0` listens on every local IPv4 interface, so use a narrower interface address when appropriate.

```bash
npm run capture:bridge -- \
  --udp-host 0.0.0.0 \
  --udp-port 9104 \
  --multicast-group 239.42.91.4
```

Use `npm run capture:bridge -- --help` and `npm run capture:demo -- --help` for all options.

## Record live serial

Choose **Live capture → Serial port**, configure the baud rate, data bits, stop bits, parity, and flow control, then select the device in the browser prompt. Device selection and connection setup are excluded from the capture clock; recording starts only after the port opens.

Web Serial is available in supported Chromium browsers and requires a secure context. Local development on `localhost` or `127.0.0.1` satisfies that requirement; see [MDN's Web Serial guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) for current browser support. NarrowsLink retains undecodable input rather than silently dropping it. Framing and sync failures remain inspectable records; a read error or disconnect produces an incomplete receipt plus an exact capture-path event that remains visible after reopening.

## Browser capability and test matrix

This matrix separates automated browser-engine evidence from hardware and assistive-technology certification. A Playwright WebKit pass is engine-level evidence, not a claim that every Safari, operating-system, or device combination has been manually certified.

| Workflow | Playwright Chromium | Playwright Firefox | Playwright WebKit | Current verification |
| --- | --- | --- | --- | --- |
| Replay, local import, saved-session library, timeline review, markers, notes, and `.nlb` export | Automated | Automated | Automated | Invalid-file recovery, validated import, exact-content deduplication, playback/rate controls, per-session workspace restoration, guarded removal, and storage failure states |
| Live UDP through the local bridge | Automated | Automated | Automated | A real ephemeral loopback bridge records fixture datagrams, stops with reconciled v2 integrity, reimports the `.nlsession`, replays it, and completes the exact-range evidence workflow |
| Independent `.nlb` verification | Automated | Automated | Automated | Browser downloads are opened independently; paths, half-open boundaries, required transport evidence, artifact bytes, record counts, manifest hashes, and `SHA256SUMS` are verified |
| Keyboard, dialogs, and responsive access | Automated | Automated | Automated | axe rules tagged WCAG A/AA, critical focus handoffs, `960`, `640`, and `390` CSS-pixel reflow, keyboard scrollers, and forced-color cues run in all three engines |
| Live serial hardware | Browser API requires `navigator.serial` and a secure context; physical path not automated | No automated hardware path | No automated hardware path | Serial lifecycle, framing, resynchronization, failure, and receipt logic are automated below the hardware permission layer; packaged browser, device, and driver combinations remain a manual boundary |

See [ACCESSIBILITY.md](ACCESSIBILITY.md) for the tested interaction matrix, claim boundary, and remaining manual screen-reader work.

## Bundled replay

`public/fixtures/harbor-relay-session.json` is a deterministic synthetic session designed to exercise the production pipeline:

- 18,402 source records over 8,435 seconds (2 h 20 m 35 s).
- UTC start at `2026-07-16T04:38:12.000Z`, displayed in `America/Los_Angeles`.
- Historical source metadata for multicast UDP `239.42.91.4:9104`; the app is replaying a file, not opening that socket.
- NSL-01 decoder revision `v1.3.7` with all five built-in packet families.
- Three incident presets covering a link fade and decoder resync, an interference burst, and a clean schema-revision transition.
- Varied deterministic packet cadence, a sustained fade and recovery, intentional missing-frame episodes, CRC failures, missing sync words, and truncated frames for forensic and error-state testing.

Regenerate it from the checked-in source script with:

```bash
npm run fixture:generate
```

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

Every time-bearing artifact is filtered to the selected half-open range. Point transport events at `startUs` are included and events at `endUs` are excluded; overlapping intervals and session-scoped integrity events are included. `transport/integrity-receipt.json`, `transport/provenance.json`, and `transport/journal.json` always describe whole-session evidence, including explicit unavailable states for legacy or pre-provenance input. All four transport artifacts are mandatory even when every optional evidence group is excluded.

`manifest.json` records the session and decoder identity, capture-integrity receipt, provenance availability and summary, exact selection, actual inclusions, media types, byte sizes, record counts, and artifact hashes. Those values describe the generated bytes, unlike the selected-group and size estimates shown before generation. `decoded/packets.csv` retains complete integrity JSON for forensic failures, and `schema/schema.json` includes the reproducible byte-level decoder definition. `SHA256SUMS` covers the manifest and each included evidence artifact.

### Verify a bundle independently

An `.nlb` can be checked without NarrowsLink because it is an ordinary ZIP archive with standard SHA-256 checksum lines. Extract into a new directory, then verify from inside that directory:

```bash
mkdir narrowslink-bundle-check
unzip path/to/incident.nlb -d narrowslink-bundle-check
cd narrowslink-bundle-check
shasum -a 256 -c SHA256SUMS
```

On systems that provide GNU Coreutils instead of `shasum`, use `sha256sum -c SHA256SUMS`. Every listed path must report `OK`; otherwise, treat the bundle as modified or incomplete. Then inspect `manifest.json` to confirm the expected session, decoder revision and schema hash, half-open selection, inclusions, file sizes, and record counts.

Checksums establish internal integrity only. Version 3 bundles are unsigned: they do not prove who created the archive or that the NarrowsLink build used to generate it was uncompromised. The receipt, provenance document, and journal prove which internal consistency checks NarrowsLink could perform and preserve every known anomaly; they cannot rule out failures that the local transport or host did not expose. Exchange the `.nlb` checksum or the expected manifest identity through a separately trusted channel when authenticity matters.

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
| `src/domain/bundle.ts` | Range-filtered, checksummed `.nlb` evidence generation and browser download |
| `src/lib/telemetry.ts` | Timeline sampling, value lookup, and source-aligned incident view ranges |
| `src/lib/time.ts` | Time-zone-aware presentation and byte-size helpers |
| `scripts/capture-bridge.mjs` | Token-protected loopback control plane, UDP socket, multicast membership, and SSE delivery |
| `scripts/send-demo-udp.mjs` | Replays checked-in fixture records as real UDP datagrams for acceptance testing |
| `scripts/generate-demo-session.mjs` | Deterministic synthetic fixture generator |
| `tests/e2e/` | Cross-browser capture-to-evidence, archive-verification, persistence, failure-recovery, accessibility, and responsive release gates |

Raw source records remain immutable. Frames, fields, metrics, diagnostics, incidents, and bundle artifacts are derived from those records, and the same path is used for the bundled fixture and imported files.

## Privacy and data handling

Serial capture, session-library persistence, replay parsing, marker and note persistence, and evidence generation happen locally in the browser. Validated canonical session documents and their identifying metadata are stored in IndexedDB; markers, authored ranges, and notes use separate per-session local storage. Removing a saved replay attempts to clear both stores, leaves any active in-memory replay open, and does not affect previously exported files. If the replay document is removed but workspace cleanup fails, NarrowsLink keeps a visible warning that residual operator context may remain in browser storage. UDP payloads move only from the local socket bridge to the local page. The bridge control plane is loopback-only and token-authenticated; the UDP listener itself binds exactly the interface selected by the operator. NarrowsLink has no account system, analytics service, telemetry upload, or cloud synchronization.

Local does not automatically mean safe to share. A saved replay or evidence bundle can contain raw bytes, device identifiers, coordinates, signal observations, and operator notes. Review and sanitize captures before committing them or sending them to someone else. Browser IndexedDB and local storage are convenient persistence mechanisms, not encrypted secrets stores.

## Current limits

- Live capture supports UDP and Web Serial; TCP and other transports are not implemented.
- The serial adapter is bound to the bundled NSL-01 decoder schema, and decoder families are compiled into the application; external schemas and protocol plug-ins are not supported.
- The active session is parsed, decoded, indexed, and bundled in browser memory. The local library stores bounded whole session documents rather than streaming or indexing large captures; every entry remains subject to the 32 MiB replay limit and the browser's available storage quota, while captures also retain the 100,000-record and 24-hour schema limits.
- IndexedDB or Web Crypto can be unavailable or reject a save. NarrowsLink surfaces the failure and keeps the validated replay usable in memory instead of claiming it was saved.
- New live captures use version 2 durable transport events, explicit UDP or serial provenance, bridge journals where applicable, and integrity receipts; legacy v1 and earlier pre-provenance v2 replays remain supported with explicit unknown or unavailable assessments.
- Version 2 does not persist each UDP sender endpoint or the bridge's internal capture ID in every source record. It does preserve browser-observed bridge errors, event-stream gaps, stop-time counter reconciliation, recorder limits, serial failures, and shutdown disposition.
- Automated coverage exercises the complete UDP capture-to-evidence loop in Playwright Chromium, Firefox, and WebKit and gates axe rules tagged WCAG A/AA, critical keyboard focus, responsive reflow, failure recovery, and independent archive verification. Physical Web Serial devices and manual screen-reader/browser combinations remain outside the automated release gate.

## Project documentation

| Document | Purpose |
| --- | --- |
| [USE_CASES.md](USE_CASES.md) | Stable catalog of supported operator outcomes, constraints, and implementation evidence |
| [CHANGELOG.md](CHANGELOG.md) | Canonical record of notable completed changes and, once they exist, tagged releases |
| [ROADMAP.md](ROADMAP.md) | Planned work, constraints, and exit criteria; completed work moves to the changelog |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, engineering invariants, review expectations, and changelog policy |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Current automated accessibility evidence, keyboard contract, support boundary, and manual certification matrix |
| [design-qa.md](design-qa.md) | Current accepted visual baseline and verification evidence |

For usage help, see [SUPPORT.md](SUPPORT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), and review [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating in project spaces.

## License

NarrowsLink is available under the [MIT License](LICENSE).
