# Contributing

Work from a fresh `origin/main` worktree and keep one coherent change per PR.
Preserve the Ez plugin boundary: provider mechanics and private receipts belong
here; business routing belongs to the consuming agent. Never add relay imports,
host launchers, provider credentials, automatic retries, or arbitrary Docker
configuration.

Run `pnpm run verify`, `pnpm run release:check`, `docker build --target runtime -t
ez-resend:check .`, and `git diff --check`. Changes to credential handling,
receipt identity, or recovery require focused negative tests.

## Beta releases

Ez CTO owns an approved beta through the protected `Release` GitHub Actions
environment: inspect the final commit and CI, pack with `npm pack --ignore-scripts`,
record its SHA-256, dispatch the exact version and `artifact-sha256`, approve
the deployment as CTO, then read back npm version/tags/integrity, the GitHub
prerelease, and the target runtime. Do not ask the owner to click a routine
release approval or provide an npm token. A new package's one-time npm 2FA and
trusted-publisher enrollment is the only bootstrap exception.

Approved beta releases use npm `latest`; versions and GitHub releases remain
prereleases. The existing OIDC workflow verifies packed bytes against the reviewed
SHA-256 before publication. A mismatch stops without an npm write. Reconcile
source and artifacts before a fresh dispatch; never overwrite a published version.
