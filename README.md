# NarrowsLink

NarrowsLink is an early-stage open source project for collecting, decoding,
inspecting, and sharing telemetry from constrained data links.

The name nods to the Gig Harbor and Tacoma Narrows area: bridges, passages,
signals, and the practical work of keeping remote systems connected.

The project is currently in its framing stage. This repository exists so the
community can see the direction, help shape the MVP, and contribute design notes,
protocol ideas, test data, and implementation work as the terminal takes form.

## Current state

- Public GitHub repository created.
- Product direction and roadmap are defined at a first-pass level.
- No runnable application has been implemented yet.
- Core decisions are still open: runtime, UI shell, ingestion interfaces,
  telemetry schema format, and storage model.

## What this should become

The first useful version should help an operator, builder, or researcher:

- Connect to a telemetry source such as serial, UDP, TCP, or replayed log files.
- Decode packets into readable fields using clear schemas.
- Watch live values, packet history, warnings, and raw bytes in one workspace.
- Record sessions and export data for analysis or sharing.
- Reproduce sessions from sample files for debugging and demos.

## Product principles

- **Reliable first:** dropped packets, invalid frames, and parser errors should be
  visible instead of hidden.
- **Portable by default:** the core should run locally without depending on a
  cloud service.
- **Inspectable:** users should be able to move between raw frames, decoded
  fields, logs, and charts without losing context.
- **Community shaped:** real protocols, weird edge cases, and field reports
  should guide the feature set.

## MVP shape

The MVP should include:

- A local app shell with a terminal-style telemetry workspace.
- File replay as the first ingestion path, followed by serial and UDP.
- A small schema format for packet definitions.
- A live packet table, decoded field inspector, raw byte view, and session log.
- Session recording and export to CSV or JSON.
- Sample datasets and documented parser examples.

See [ROADMAP.md](ROADMAP.md) for the staged plan.

## How to help

Good first contributions right now:

- Share telemetry formats or sample logs that would make useful fixtures.
- Open an issue describing the first data source you want supported.
- Propose UI workflows for live monitoring, packet replay, or parser debugging.
- Help define the MVP architecture before the first implementation pass.

See [CONTRIBUTING.md](CONTRIBUTING.md) for collaboration guidelines.

## License

License is not selected yet. Until a license is added, please treat the code and
project materials as all rights reserved.
