# Contributing

Thanks for helping. LOOP is a personal project that others run for themselves, so changes have to work for any
user's data, never just one person's.

## Before you start

- For anything bigger than a small fix, open an issue first to agree on the change.
- Read [`docs/development.md`](docs/development.md): setup, commands, tests, generated files, guards and the
  workflow. Then read the doc of the area you are changing (the map is in [`CLAUDE.md`](CLAUDE.md)).

## Rules

- **Never commit personal or health data**: no real exports, food logs, profiles, reports or screenshots with
  real numbers. The personal files are gitignored and a guard hook blocks forcing them in; `data/demo/` is the
  only tracked data and must stay synthetic.
- **Never hand-edit generated files**; change the source and run its generator (the table is in
  `docs/development.md`).
- **Tests and docs ship with the change**: one commit carries the behaviour, its tests and the doc that describes
  it. Dated history goes to [`CHANGELOG.md`](CHANGELOG.md).
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `chore:`, ...).

## Pull requests

1. Branch from `main`.
2. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:services`; CI runs them all again, plus the
   real-Postgres suite, on the pull request.
3. Describe what changes for someone running LOOP, and how you checked it.

Security problems go through the private channel in [`SECURITY.md`](SECURITY.md), not a public issue or PR.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
