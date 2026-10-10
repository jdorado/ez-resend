# Changelog

## 0.1.0-beta.4

- Requires Ez core 0.1.0-beta.50 or newer for the manifest example.
  Older cores refuse the update and retain the installed version.
- Add a representative manifest example for tool discovery.

- Add a bounded, date-filtered read-only listing of retained receipt metadata
  across all claim states. Report truncation and undated receipt counts without
  contacting the provider, exposing message bodies, or modifying receipt state.
  Listed `from` and `subject` are limited to 200 characters, unreadable receipt
  files are skipped by the listing only and counted as `unreadable` (claim,
  status, and events still fail closed on them), and a message without a source
  date is stored undated instead of using the capture time.

## 0.1.0-beta.3

- Derive CLI version from package metadata and validate release consistency.
- Publish approved prereleases to npm latest while retaining beta versions.
- Verify the reviewed artifact digest before the existing OIDC publisher writes
  to npm. Preserve the protected release environment and its provider trust.

## 0.1.0-beta.2

- Fix `events` and `events-check` client argument serialization so captured
  receipts are inspectable through the normal plugin CLI.

## 0.1.0-beta.1

- Initial reusable Dockerized Resend receiving plugin with private API-key setup,
  bounded receiving reads, idempotent raw-message receipts, and durable
  capture-claim-acknowledgement state. The Docker service owns its 15-minute
  capture loop and exposes portable Ez event-source reads.
