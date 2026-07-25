# NarrowsLink user guide

This guide covers NarrowsLink operation from installation through local capture, replay, incident authoring, evidence export, and receiver verification. Source contributors should use [CONTRIBUTING.md](CONTRIBUTING.md).

The installation section remains specific to the tagged v0.1.0 package. Decoder-pack and NMEA procedures are available in the current repository under `[Unreleased]` and will require a later packaged release.

NarrowsLink keeps telemetry, saved sessions, operator annotations, and evidence generation on the local machine. It does not provide accounts, cloud storage, hosted ingestion, or telemetry upload.

## Requirements

You need:

- Node.js 20.19 or newer.
- A local browser.
- A supported Chromium browser for physical Web Serial capture.
- Enough browser storage for the sessions you plan to retain.
- The four files from the [NarrowsLink v0.1.0 release](https://github.com/zrack/narrowslink/releases/tag/v0.1.0).

The release package contains the production application, authenticated UDP bridge, bundled Harbor relay replay, and evidence receiver CLI. A source checkout, Vite, and project dependencies are not required.

## Install and verify v0.1.0

Download these four release assets into one directory:

- `narrowslink-0.1.0.tgz`
- `narrowslink-0.1.0.release.json`
- `narrowslink-0.1.0.cdx.json`
- `SHA256SUMS`

On macOS, verify the published checksum set:

```bash
shasum -a 256 -c SHA256SUMS
```

On GNU/Linux:

```bash
sha256sum -c SHA256SUMS
```

All three listed assets must report `OK`. The checksum file is delivered through the same release channel as the package, so this proves byte consistency, not independent publisher authenticity.

Install the package without running lifecycle scripts:

```bash
npm install --global ./narrowslink-0.1.0.tgz --ignore-scripts
```

Confirm the installed identity:

```bash
narrowslink version --json
```

For v0.1.0, the output must identify version `0.1.0` and commit:

```text
a9d6c6b737086d4240accc347a0a5d62f76d9531
```

Compare that output with `narrowslink-0.1.0.release.json`. If the version or commit differs, stop and resolve the package mismatch before collecting evidence.

## Start and stop NarrowsLink

Start the application:

```bash
narrowslink serve
```

The command starts the production UI and authenticated bridge in one process, then opens:

```text
http://127.0.0.1:47890/
```

If the browser does not open, leave the command running and open the printed URL yourself. To prevent automatic browser launch:

```bash
narrowslink serve --no-open
```

Press `Ctrl+C` in the serving terminal to stop the application server and bridge cleanly.

Keep the default application port when you want access to an existing local session library. Browser storage belongs to the exact origin `http://127.0.0.1:47890`; another application port or browser profile selects different storage.

Use `narrowslink serve --help` to inspect bind and launch options. UDP-related command-line flags populate the capture dialog defaults. They do not start a UDP socket until you select **Start UDP capture**.

## First run with the bundled replay

NarrowsLink validates and opens **Harbor relay downlink** automatically at startup. This synthetic session is the safest way to learn the workspace.

![NarrowsLink mission-timeline session review workspace](docs/assets/narrowslink-dashboard.png)

1. Select **Play replay**.
2. Move **Replay position** or choose a point on the mission timeline.
3. Change **Replay speed** to inspect slow transitions or cross a long quiet interval.
4. Choose each preset from **Selected incident**.
5. Review the **Narrative**, **Details**, **Provenance**, and **Stats** tabs.
6. Compare the Connection, Throughput, Packet loss, packet-family, Decoder, Diagnostics, Marker, and decoded-signal lanes at the same playhead.
7. Select **Save current replay** if you want the fixture in the local session library.

The fixture contains deliberate fades, inferred missing frames, checksum failures, missing sync words, truncated frames, and decoder recovery. Its multicast metadata is historical replay evidence; opening the fixture does not bind a live multicast socket.

## Workspace tour

The main workspace has five working areas:

| Area | What it does |
| --- | --- |
| Sessions rail | Opens local replays, starts live capture, saves or reopens sessions, and shows source and integrity facts |
| Top controls | Opens capture or replay files, controls playback and rate, adds markers, and starts bundle creation |
| Session overview | Shows the whole recording and its available incident presets or local ranges |
| Mission telemetry timeline | Aligns link, packet, decoder, diagnostic, marker, and decoded-signal evidence to one replay clock |
| Incident and bundle panels | Review the selected range, provenance, statistics, annotations, and evidence contents |

On narrow screens, use **Saved (n)** to open the same session library in a dialog.

## Open a local replay

NarrowsLink accepts `.json` and `.nlsession` files using session format v1 or v2.

1. Select **Open replay**, **Open local replay**, or **Replace session**.
2. Choose the local file.
3. Wait for validation and decoding.
4. Confirm the expected title, source, decoder pack and runtime identity, duration, and integrity state.

A valid imported file becomes the active replay and NarrowsLink attempts to save its canonical bytes in the local library. A failed or oversized file does not replace a valid replay.

Session format v1 is preserved unchanged and reports `unknown` legacy capture integrity. Earlier valid v2 sessions without current provenance remain valid and report the missing evidence as unavailable.

## Choose or load a decoder pack

Every new capture uses one decoder pack. The default is **NSL-01 v1.3.7**.

1. Open **Live capture**.
2. Under **Decoder pack**, choose the bundled NSL-01 or NMEA 0183 reference pack.
3. To use a local pack, select **Load pack** and choose a `.nldecoder` or `.json` file.
4. Wait for the loaded-pack notice. Do not begin a test if identity, compatibility, or fixture validation fails.
5. Confirm the displayed runtime revision and first 12 characters of the pack SHA-256 against the expected pack identity.

Pack selection is locked once capture setup begins. The resulting `.nlsession` embeds the exact pack, schema, runtime, and revision identities. NarrowsLink accepts only bounded declarative packs for its supported runtime allowlist and does not run pack-supplied JavaScript.

For pack authoring, offline validation, NMEA record boundaries, and the trust model, use [DECODER_PACKS.md](DECODER_PACKS.md).

## Record live UDP

The installed release manages the authenticated bridge. The operator never copies a bearer token.

![NarrowsLink live UDP capture setup](docs/design/live-capture-setup.jpg)

1. Start NarrowsLink with `narrowslink serve`.
2. Select **Live capture** or **Capture**.
3. In **Record live telemetry**, leave **UDP bridge** selected.
4. Confirm **Managed local bridge · authenticated**. The installed release should not show manual **Bridge URL** or **Bridge token** fields.
5. Enter a **Session title**.
6. Confirm the **Display timezone** is a valid IANA name, such as `America/Los_Angeles`.
7. Select or load the decoder pack that matches the incoming datagrams.
8. Set **UDP bind host** and **UDP port**.
9. For multicast, set **Multicast group** and, when needed, **Multicast interface**. The bind address and group must use the same IP family.
10. Select **Start UDP capture**.
11. Confirm the status is **Recording** and send telemetry to the exact address shown under **Source**.
12. Watch **Datagrams received**, **Input bytes**, **Records retained**, **Bytes retained**, and **Bridge state**.
13. Select **Stop, save & replay**.

Using UDP port `0` lets the bridge choose an available port. Read the actual bound port under **Source** before starting the sender.

For NMEA 0183, send one complete `$...*HH` sentence per UDP datagram. Concatenating multiple sentences into one datagram is not split automatically.

For traffic from another machine, bind the receiving computer's interface address or `0.0.0.0`. The latter listens on every local IPv4 interface, so prefer a narrower address when possible. Firewall and routing rules still apply.

This example supplies unicast or multicast defaults before startup:

```bash
narrowslink serve \
  --udp-host 0.0.0.0 \
  --udp-port 9104 \
  --multicast-group 239.42.91.4
```

The dialog remains the final per-capture configuration. Selecting **Stop, save & replay** downloads a version 2 `.nlsession`, opens the validated finalized capture, and attempts to retain it in the local library.

![NarrowsLink replaying and investigating a captured UDP burst](docs/design/live-capture-replay.jpg)

## Record live serial telemetry

Physical serial capture requires a browser with Web Serial support, normally a Chromium browser, and a secure loopback page.

1. Select **Live capture** or **Capture**.
2. Select the **Serial port** tab.
3. Enter a **Session title** and confirm the **Display timezone**.
4. Select or load the decoder pack that matches the serial stream.
5. Set **Baud rate**, **Data bits**, **Stop bits**, **Parity**, and **Flow control**. The defaults are `115200`, `8`, `1`, `None`, and `None`.
6. Select **Select port & start**.
7. Choose the device in the browser's native prompt.
8. Confirm **Serial state: open** and status **Recording**.
9. Watch the serial reads, input bytes, retained records, and retained bytes.
10. Select **Stop, save & replay**.

Device selection and port setup happen before the capture clock starts. NarrowsLink retains undecodable and partial input as evidence. A disconnect or read failure produces an incomplete receipt and a capture-path diagnostic rather than silently claiming a clean capture.

NSL-01 serial framing uses its sync word and declared binary length. NMEA serial framing uses line-feed boundaries, preserves CRLF, and retains overlong or unterminated tails as bounded partial records.

The automated release gate exercises the serial application path with an injected standards-based API. It does not certify physical adapters, USB drivers, native device choosers, or operating-system disconnect behavior.

## Replay and investigate a session

1. Select a preset or operator-authored range from **Selected incident**.
2. Use **Play replay**, **Pause replay**, **Replay again**, the position slider, and the speed control.
3. Correlate the same moment across the timeline lanes.
4. Use **Narrative** for ordered evidence-backed events.
5. Use **Details** for capture integrity and evidence-domain facts.
6. Use **Provenance** for UDP endpoint and bridge-journal evidence or serial device and negotiated-setting evidence.
7. Use **Stats** for range-level measures.
8. Inspect malformed, checksum-failed, partial, and unknown frames instead of treating them as absent.

Capture-path diagnostics describe local collection failures. Keep them distinct from source-link and decoder failures when writing an incident conclusion.

## Create an exact incident range

Use a local range when a replay preset is too broad or the session has no preset.

1. Seek near the event.
2. Select **New range**.
3. Give the range a short **Title**.
4. Enter **Start · included** and **End · excluded** as `HH:MM:SS.ffffff` offsets from session start.
5. Choose **Info**, **Warning**, or **Critical** severity.
6. Select **Create range**.

Incident ranges use half-open semantics: `[start, end)`. The start instant is included; the end instant is excluded. NarrowsLink stores the offsets as integer microseconds.

Use the amber timeline handles for rapid adjustment, then use **Edit operator range** for exact boundaries. Replay presets remain immutable. Select **Refine replay preset as a local range** to create an editable copy.

Deleting a local range does not change the replay or an archive that was already exported.

## Add markers and a session note

Select **Add marker** to attach operator context to the replay clock.

The marker dialog accepts:

- **Offset from session start (seconds)**
- **Title**
- **Category**: Observation, Field note, or Maintenance
- **Note**

Use **Session-wide operator note** for context that applies to the whole replay. Markers, authored ranges, and notes are local overlays. They do not modify raw session records.

When browser storage is available, the workspace is restored by session identity. If storage is unavailable, the visible workspace remains usable in memory and can still be included in the next bundle.

## Export an evidence bundle

An incident must be selected before export.

1. Review **Incident bundle preview**.
2. Choose the optional evidence groups needed by the receiver:
   - **Raw source records (NDJSON)**
   - **Decoded packets (CSV)**
   - **Decoder schema**
   - **Diagnostics**
   - **Operator context**
3. Keep **Decoder schema** selected for a non-built-in or locally loaded pack so the receiving verifier can reproduce the interpretation.
4. Leave **Capture integrity** selected. It is required and cannot be removed.
5. Confirm the displayed range and estimated size.
6. Select **Create incident bundle**.
7. In **Package this incident for handoff?**, select **Build and download**.
8. Confirm **Handoff archive is ready** and retain the downloaded `.nlb`.

The preview size is an estimate. The archive manifest contains the actual artifact list, byte sizes, counts, selection, and SHA-256 hashes.

Every bundle includes range-filtered transport events and whole-session provenance, bridge-journal, and integrity-receipt artifacts. Optional source, decoded, diagnostic, schema, marker, and note artifacts follow the selected incident and inclusion controls.

## Verify a received bundle

Treat received `.nlb` bytes as untrusted.

1. Install a verified NarrowsLink release package on the receiving machine.
2. Run the production verifier before opening or extracting the archive:

```bash
narrowslink verify path/to/incident.nlb
```

For a stable machine-readable report:

```bash
narrowslink verify path/to/incident.nlb --json
```

A passing human-readable report identifies:

- Whole-bundle SHA-256 and byte size
- Session, source, and format
- Exact half-open selection
- Artifact count
- Internal-integrity verdict
- Aggregate, capture, and provenance evidence states
- Warnings
- Authenticity status
- Decoder-pack identity and whether selected raw records reproduced the exported decoded rows

Exit statuses are:

| Status | Meaning |
| --- | --- |
| `0` | The version 3 archive is internally consistent |
| `1` | The archive is invalid, tampered, unsafe, or unsupported |
| `2` | Command usage or local file I/O failed |

Do not extract a bundle that exits `1`. Correct path, permissions, or command usage before retrying an exit `2`.

A valid bundle can truthfully report `incomplete` or `unknown` capture or provenance evidence. Version 3 bundles are unsigned, so the verifier reports authenticity as `not-established`. Exchange the reported bundle SHA-256 or expected manifest identity through a separately trusted channel when authorship or source-channel authenticity matters.

## Use the local session library

The Sessions rail contains validated canonical sessions stored in IndexedDB.

- Select **Save current replay** to retain the active bundled replay when it is not already saved.
- Imported files and finalized captures automatically attempt a library save.
- Select a saved row to reopen it. NarrowsLink re-hashes, parses, validates, and decodes the stored bytes before replacing the active replay.
- Saving exact duplicate canonical content is idempotent; it remains one entry.
- Select the remove control, then **Remove**, to delete a saved replay.
- Use **Retry local library** after a temporary storage failure.

Removing a saved replay also attempts to clear its markers, note, and authored ranges. The active in-memory replay stays open, and exported files are not deleted. If workspace cleanup fails, NarrowsLink leaves a persistent residual-data warning.

A storage error does not mean a session was saved. Keep the downloaded `.nlsession` when the browser reports that IndexedDB, Web Crypto, quota, or the transaction prevented persistence.

## Upgrade NarrowsLink

1. Download the newer package, release manifest, SBOM, and `SHA256SUMS`.
2. Verify the new checksum set.
3. Stop the running `narrowslink serve` process with `Ctrl+C`.
4. Install the new package:

```bash
npm install --global ./narrowslink-<version>.tgz --ignore-scripts
```

5. Confirm the new identity:

```bash
narrowslink version --json
```

6. Start NarrowsLink on the same `127.0.0.1` application port with the same browser profile:

```bash
narrowslink serve
```

The installed package and browser-held library are separate. Replacing package files does not remove sessions or operator workspace data.

## Remove NarrowsLink

Stop the running process, then uninstall the package:

```bash
npm uninstall --global narrowslink
```

Uninstalling does not delete:

- The browser-held session library
- Markers, notes, or authored ranges
- Downloaded `.nlsession` files
- Exported `.nlb` bundles

To intentionally purge the browser-held library and workspace, preserve any required captures and then clear site data for `http://127.0.0.1:47890` in that browser profile. Package removal never deletes exported files.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `narrowslink` is not found | Confirm the global npm binary directory is on `PATH`, then rerun `narrowslink version --json`. Do not substitute an unverified package. |
| The browser did not open | Keep `narrowslink serve` running and open the printed loopback URL. |
| Port `47890` is occupied | Stop the existing process when possible. An alternate `--app-port` works, but it selects a different browser-storage origin. |
| The managed capture status is missing or invalid | Start the installed package with `narrowslink serve`; do not serve the application directory as static files. |
| UDP capture will not start | Confirm the bind address exists locally, the port is free, and multicast group and interface values use the same IP family. |
| UDP counters remain at zero | Confirm status **Recording**, send to the exact address under **Source**, and check firewall, routing, and sender configuration. |
| A decoder pack will not load | Confirm the file is at most 512 KiB, was sealed with `narrowslink decoder seal`, uses a supported runtime, and passes its bundled fixtures. |
| NMEA records are partial or unknown | Send one sentence per UDP datagram, or terminate each serial sentence with LF; confirm `$` prefix and `*HH` checksum. |
| Web Serial is unavailable | Use a supported Chromium browser at the loopback application URL, or use UDP capture. |
| Status says **Recording with attention required** | Stop and preserve the retained records. Expect incomplete capture evidence and review its issue codes. |
| The finalized session did not download | Select **Retry download**. The finalized session remains available until it is downloaded or explicitly discarded. |
| Finalization failed | Select **Retry finalization**. Discard only when losing the retained capture is acceptable. |
| A replay cannot be opened | Choose another file or load the bundled replay. Check the extension, session format, 32 MiB file limit, and file integrity. |
| The library is unavailable or full | Keep using the active replay, free site storage if possible, then select **Retry local library**. Preserve downloaded session files. |
| Saved sessions appear missing after upgrade | Return to the same `127.0.0.1` application port and browser profile. |
| Verifier exits `1` | Treat the bundle as invalid or unsupported and do not extract it. |
| Verifier exits `2` | Correct the file path, permissions, or command usage and retry. |

## Privacy, security, and authenticity

NarrowsLink does not upload telemetry, but local evidence can still be sensitive. Sessions and bundles may contain:

- Raw telemetry bytes
- Device identifiers
- Coordinates
- Signal observations
- UDP endpoint addresses
- Operator markers and notes

Review and sanitize evidence before committing it to a repository, attaching it to an issue, or sending it to another person. Browser IndexedDB and local storage are persistence mechanisms, not encrypted secrets stores.

The managed bridge control plane is loopback-only and uses an internal short-lived credential. The UDP listener still binds the interface chosen by the operator and can receive traffic from that interface.

Release checksums and bundle verification establish internal consistency. The v0.1 release, checksum file, and version 3 evidence bundles are unsigned. They do not establish publisher, author, source-channel, or build-environment authenticity.

## Current operating limits

- Live capture supports UDP and Web Serial, not TCP or other transports.
- Bundled packs support NSL-01 and checksummed NMEA 0183 GGA, RMC, and HDT. Local packs are limited to supported bounded runtimes; arbitrary code and automatic protocol detection are not supported.
- Session import and canonical library files are limited to 32 MiB.
- Capture documents are limited to 100,000 records and 24 hours.
- Active parsing, decoding, indexing, and bundle construction happen in browser memory.
- Browser quota and Web Crypto availability can prevent a library save.
- Only one replay is active at a time.
- Physical Web Serial hardware and manual screen-reader/browser combinations remain outside the automated release gate.
- Receiver verification proves internal bundle consistency, not authorship.

## Command reference

| Command | Purpose |
| --- | --- |
| `narrowslink --help` | Show available commands |
| `narrowslink version --json` | Print the installed version and commit |
| `narrowslink serve` | Start the production UI and authenticated bridge |
| `narrowslink serve --help` | Show application, bridge, UDP, multicast, and launch options |
| `narrowslink serve --no-open` | Start without opening a browser |
| `narrowslink verify incident.nlb` | Verify a received evidence bundle locally |
| `narrowslink verify incident.nlb --json` | Emit the stable machine-readable verification report |
| `narrowslink decoder seal draft.json --out pack.nldecoder` | Seal and conformance-test a decoder-pack draft without overwriting output |
| `narrowslink decoder validate pack.nldecoder` | Validate pack identity, runtime compatibility, and fixtures offline |

## Get help

- Read [README.md](README.md) for product capabilities, formats, architecture, privacy, and current limits.
- Read [USE_CASES.md](USE_CASES.md) for supported outcomes and constraints.
- Read [ACCESSIBILITY.md](ACCESSIBILITY.md) for keyboard behavior and the tested accessibility boundary.
- Use [SUPPORT.md](SUPPORT.md) to prepare a reproducible support request.
- Report vulnerabilities through [SECURITY.md](SECURITY.md).
