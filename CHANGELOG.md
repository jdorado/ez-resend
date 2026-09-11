# Changelog

## 0.1.0-beta.2

- Fix `events` and `events-check` client argument serialization so captured
  receipts are inspectable through the normal plugin CLI.

## 0.1.0-beta.1

- Initial reusable Dockerized Resend receiving plugin with private API-key setup,
  bounded receiving reads, idempotent raw-message receipts, and durable
  capture-claim-acknowledgement state. The Docker service owns its 15-minute
  capture loop and exposes portable Ez event-source reads.
