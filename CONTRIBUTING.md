# Contributing

Work from a fresh `origin/main` worktree and keep one coherent change per PR.
Preserve the Ez plugin boundary: provider mechanics and private receipts belong
here; business routing belongs to the consuming agent. Never add relay imports,
host launchers, provider credentials, automatic retries, or arbitrary Docker
configuration.

Run `npm run verify`, `npm run release:check`, `docker build --target runtime -t
ez-resend:check .`, and `git diff --check`. Changes to credential handling,
receipt identity, or recovery require focused negative tests.
