# Contributing

Work from a fresh `origin/main` worktree and keep one coherent change per PR.
Preserve the Ez plugin boundary: provider mechanics and private receipts belong
here; business routing belongs to the consuming agent. Never add relay imports,
host launchers, provider credentials, automatic retries, or arbitrary Docker
configuration.

Run `npm run verify`, `npm run release:check`, `docker build --target runtime -t
ez-resend:check .`, and `git diff --check`. Changes to credential handling,
receipt identity, or recovery require focused negative tests.

## Beta releases

Ez CTO owns an approved beta through the protected `Release` GitHub Actions
environment: inspect the final commit and CI, dispatch the exact version, approve
the deployment as CTO, then read back npm version/tags/integrity, the GitHub
prerelease, and the target runtime. Do not ask the owner to click a routine
release approval or provide an npm token. A new package's one-time npm 2FA and
trusted-publisher enrollment is the only bootstrap exception.
