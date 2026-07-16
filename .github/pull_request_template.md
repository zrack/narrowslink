## Operator outcome

<!-- What becomes safer, clearer, faster, or newly possible for an operator? -->

## Scope

<!-- Summarize the implementation and call out intentional non-goals. -->

Closes #

## Verification

- [ ] `npm run check` passes locally.
- [ ] I exercised the affected capture, import, replay, investigation, or export path.
- [ ] Tests cover changed pure domain logic and relevant failure cases.

Additional commands, results, or manual steps:

## Compatibility and evidence

- [ ] Session, record, packet, diagnostic, or bundle schema impact is described below.
- [ ] Replay timing and UTC/IANA-timezone behavior remain correct or are described below.
- [ ] Incident ranges remain half-open (`[startUs, endUs)`) or any migration is described below.
- [ ] Malformed and partial frames remain inspectable.
- [ ] Evidence artifact contents, hashes, and verification behavior remain correct or are described below.
- [ ] Existing fixtures and imported sessions remain compatible or a versioned migration is included.

Compatibility notes (write “No compatibility impact” when applicable):

## Telemetry safety and provenance

- [ ] This PR contains no secrets, personal data, operational payloads, precise locations, device identifiers, or other sensitive telemetry.
- [ ] Added or changed fixtures are synthetic or explicitly licensed, and their provenance and generation steps are documented.
- [ ] The bundled fixture and user-imported data use the same validation, decoding, replay, incident, and export pipeline where applicable.

Fixture provenance or generation command (write “Not applicable” when applicable):

## Visual evidence

<!-- Required for visible UI changes. Add before/after screenshots and the viewport dimensions. -->

- [ ] Not applicable, or screenshots and viewport dimensions are included below.

## Documentation and migration

- [ ] User-facing behavior, schemas, workflows, or compatibility changes are documented.
- [ ] No migration is needed, or migration and rollback guidance is included below.

Documentation or migration notes:

## Reviewer focus

<!-- Identify the highest-risk assumptions, invariants, or files for reviewers. -->
