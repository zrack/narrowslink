# NarrowsLink Support

NarrowsLink is an early-stage local application. Community support is provided through GitHub on a best-effort basis; there is no guaranteed response time or production support agreement.

## Start here

1. Read the setup and workflow guidance in [README.md](README.md).
2. Reproduce the behavior with the bundled synthetic fixture on the latest `main` branch.
3. Run `npm run check` and record the failing command or test name.
4. Search existing issues before filing a new report.

Use the structured bug form for a reproducible product defect and the feature form for a proposed operator outcome. Include the NarrowsLink commit, operating system, browser version, workflow path, telemetry source type, and minimal reproduction steps.

## Protect telemetry

GitHub issues are public when this repository is public. Do not post credentials, operational payloads, personal data, precise locations, device identifiers, proprietary protocols, or evidence bundles from real sessions. Prefer the bundled fixture or a minimal synthetic sample and document how it was generated. Sanitizing a capture does not replace authorization to share it.

If a problem cannot be demonstrated without sensitive data, describe its structure and observable failure without attaching the source. Security vulnerabilities belong in [GitHub’s private vulnerability reporting flow](https://github.com/zrack/narrowslink/security/advisories/new), not in support or bug discussions.

## Scope

Useful support requests cover NarrowsLink installation, supported capture/import paths, replay and incident behavior, decoder diagnostics, evidence-bundle generation, and verifiable reproductions against the current repository state.

Project maintainers cannot validate field hardware, authorize telemetry disclosure, recover damaged source data, or guarantee compatibility with undocumented proprietary protocols. For a new protocol or workflow, open a feature request with testable acceptance criteria and a synthetic fixture plan.
