# Roadmap

This roadmap frames the project from empty repository to community-usable MVP.
It should evolve as real users bring telemetry sources, protocols, and operating
constraints into the conversation.

## Phase 0: Project Frame

Status: in progress

- Define the project vision, audience, and contribution path. Done.
- Create the public GitHub repository. Done.
- Publish an initial roadmap and README. Done.
- Decide the license.
- Collect early community feedback on use cases and protocol needs.

Exit criteria:

- The repository explains what the project is and how to help.
- There is a clear MVP target.
- The community has a place to file examples, requests, and questions.

## Phase 1: Technical Foundation

Status: next

- Choose the app architecture and runtime.
- Create the initial application skeleton.
- Add automated formatting, linting, and test commands.
- Define the core telemetry domain model:
  - source
  - frame
  - packet
  - decoded field
  - session
  - parser diagnostic
- Add a small fixture set for replay-driven development.

Exit criteria:

- A developer can clone the repo, run the app, and execute tests.
- A sample telemetry log can be loaded through a core replay path.

## Phase 2: Ingestion And Replay

Status: planned

- Implement file replay as the first source type.
- Add source status, timing controls, pause, resume, and seek.
- Add serial ingestion.
- Add UDP ingestion.
- Capture invalid frames and source errors as first-class events.

Exit criteria:

- Users can load a fixture or connect a basic live source.
- The app distinguishes raw data, decoded packets, and diagnostics.

## Phase 3: Decoder System

Status: planned

- Define a simple schema format for packet layouts.
- Support field types, byte order, scaling, units, enums, and checksums.
- Add parser validation and helpful error messages.
- Provide example decoders.
- Add tests for known-good, malformed, and partial packets.

Exit criteria:

- A user can add a schema and see decoded telemetry without changing app code.
- Parser failures are understandable and reproducible.

## Phase 4: Operator Workspace

Status: planned

- Build the main terminal workspace:
  - source controls
  - packet stream
  - decoded field inspector
  - raw byte view
  - diagnostics panel
  - session timeline
- Add filtering, search, and packet pinning.
- Add basic charts for selected numeric fields.
- Make the interface resilient with large streams.

Exit criteria:

- The app is useful for live inspection and replay debugging.

## Phase 5: Sessions And Sharing

Status: planned

- Record telemetry sessions locally.
- Export decoded data to CSV and JSON.
- Export raw captures for reproduction.
- Add project-level examples and demo sessions.
- Document how to share logs without exposing sensitive data.

Exit criteria:

- A community member can reproduce a bug or demo from a shared session.

## Phase 6: Community Release

Status: planned

- Pick and publish the project license.
- Add release notes and versioning.
- Create labels for good first issues, protocol requests, and design discussions.
- Publish a demo walkthrough.
- Invite protocol fixtures and use-case reports from the community.

Exit criteria:

- The project has a clear contribution loop and a usable early release.

## Open decisions

- App runtime: web app, Electron/Tauri desktop app, CLI-first, or hybrid.
- Schema format: custom JSON/YAML, Kaitai Struct, Protocol Buffers, or another
  existing parser ecosystem.
- Storage: plain files, SQLite, or append-only logs.
- First live source: serial, UDP, TCP, SDR-derived stream, or another source.
- Visualization scope for MVP.
