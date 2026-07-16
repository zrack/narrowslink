# Security Policy

## Supported versions

NarrowsLink is a pre-1.0 project under active development. Security fixes are made on the current `main` branch and included in the next release when releases are available. Older commits, forks, and superseded 0.x releases do not receive guaranteed backports.

| Version | Supported |
| --- | --- |
| Current `main` and latest 0.x release | Yes |
| Older commits and superseded 0.x releases | No |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting flow instead:

1. Open the repository's [Security advisories](https://github.com/zrack/narrowslink/security/advisories) page.
2. Select **Report a vulnerability**.
3. Describe the affected version or commit, the impact, and the minimum steps needed to reproduce the issue.

If the private reporting option is unavailable, do not disclose the vulnerability publicly. Contact the repository owner through their GitHub profile and ask for a private reporting channel without including sensitive technical details.

The maintainer will acknowledge reports as soon as practical, assess their severity and reproducibility, and coordinate remediation and disclosure through the private advisory. Response and fix timing depends on the issue's impact, complexity, and maintainer availability; this project does not currently offer a response-time SLA.

## Protect operational data

Never attach raw telemetry, capture files, evidence bundles, precise coordinates, access tokens, credentials, or device identifiers to a public issue, discussion, pull request, or comment. Start with a sanitized description and synthetic reproduction. If sensitive artifacts are necessary to investigate, coordinate their transfer privately and provide only the minimum data required.

Public reports may include redacted logs and synthetic fixtures after confirming that they contain no operational or identifying data.
