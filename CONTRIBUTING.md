# Contributing

Thanks for helping shape NarrowsLink. The project is early, so the
most valuable contributions are clear use cases, sample data, architecture
feedback, and small implementation slices once the foundation lands.

## Useful contributions now

- Telemetry sample files that can become public fixtures.
- Notes about protocols, packet formats, checksums, and failure modes.
- Descriptions of live operating workflows.
- UI sketches or workflow proposals.
- Small issues that clarify the MVP.

## Before opening a pull request

- Open or reference an issue for substantial changes.
- Keep changes focused on one topic.
- Include sample data or tests when changing parser behavior.
- Avoid committing secrets, private telemetry, or sensitive location data.

## Development setup

There is no runnable app yet. Once the technical foundation is selected, this
section should include install, run, test, lint, and build commands.

## Issue labels to add

- `good first issue`
- `protocol request`
- `sample data`
- `architecture`
- `ui`
- `decoder`
- `source`
- `documentation`

## Community norms

- Assume people are working with different hardware, bandwidth, and field
  constraints.
- Explain protocol examples with enough context to reproduce them.
- Prefer small, testable changes.
- Be careful with shared telemetry. Strip secrets, identifiers, and sensitive
  coordinates before posting logs.
