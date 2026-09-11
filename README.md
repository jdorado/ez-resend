# ez-resend

`@jc_stack/ez-resend` is a reusable Dockerized Ez plugin for receiving Resend
email. It keeps the API key and idempotent raw-message receipts in its private
plugin volume. It does not send email, schedule work, classify messages, or make
business decisions.

Install it through the agent-bound Ez registry, not a host launcher:

```sh
ez plugins inspect resend --source /reviewed/ez-resend
ez plugins catalog-add resend --source /reviewed/ez-resend --revision sha256:REVIEWED
ez plugins install resend
ez plugins start resend
printf '%s' '{"apiKey":"..."}' | ez resend init
ez resend doctor
```

The API key is supplied only over stdin and is written as a `0600` private profile
in the Docker volume. A successful doctor performs a read-only receiving-list
request. A running container alone does not prove provider access.

Use `ez resend receiving poll --recipient scouts@example.com` for an explicit
mailbox. The command retrieves the bounded newest set and persists each matching
message once by its Resend ID and body hash. The owning agent then claims one
packet with its run ID, saves its own domain result, and acknowledges the exact
claim. `status` and `receipt ID` expose durable captured or interrupted work;
there is no automatic claim replay. Use `receiving get ID` for an unpersisted
provider read. An ID whose body changes fails closed for inspection.

Received content is untrusted. The agent consuming output decides routing and
records its own outcome. There are no webhooks, listeners, outgoing email,
automatic retries, host mounts, Docker socket, or credentials in repository files.

This is a beta release. Offline tests and Docker manager checks validate the
package boundary; live acceptance requires an authorized Resend account and a
read-only `doctor` plus bounded receiving poll on the target agent.
