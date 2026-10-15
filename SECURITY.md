# Security policy

LOOP is self-hosted: you run it on your own machine, with your own data, on your own network. There is no
LOOP server and no hosted service, so a vulnerability means one in this code or in its default configuration.

## Supported versions

Only the latest release (the newest `## [X.Y.Z]` in [`CHANGELOG.md`](CHANGELOG.md), and the matching
`mralexandersaavedra/loop-ingest` image) gets fixes. Update with [`docs/guides/upgrading.md`](docs/guides/upgrading.md).

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on this repository (a private security
advisory). If that button is not there, open an issue that only asks for a private contact, with no details of the
problem, and the maintainer will reach out. Please never put the details in a public issue, and do not include
anyone's real health data in the report; a minimal reproduction with the demo data (`data/demo/`) is ideal.

You can expect an acknowledgement within a week. Once a fix is released, the advisory is published with credit,
unless you prefer to stay anonymous.

## In scope

- The data service (`services/loop-ingest`): authentication of the ingest token, the food, journal, profile and
  sync endpoints, the Host and Origin checks, input limits.
- The page server (`services/loop-web`): the nginx configuration, the proxied paths, the security headers.
- The page itself: anything that lets data or script from outside reach it (it is built as one self-contained file).
- The guard hook (`.claude/hooks/guard-health-data.js`): a way to commit personal data past it.

## Out of scope

- Exposing the services in any way other than the documented one: the services are built for a trusted LAN, and
  the only supported exposure is `loop-web` behind an SSO tunnel with the documented bypass rules
  ([`services/loop-web/README.md`](services/loop-web/README.md) → Exposing behind an SSO tunnel). The ingest port
  itself is never meant to be reachable from outside the LAN. A flaw in that documented setup IS in scope.
- Vulnerabilities in third-party images or packages with no impact on LOOP's use of them (Dependabot tracks those).
- Anything that needs an attacker who already controls your machine or your Claude Code session.
