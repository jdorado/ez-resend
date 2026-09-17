# Changelog

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
