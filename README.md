# ez-resend

`@jc_stack/ez-resend` is a reusable Dockerized Ez plugin for receiving Resend
email. Its resident Docker service owns bounded periodic capture into private,
idempotent raw-message receipts. It does not send email, classify messages, or
make business decisions.

Install it through the agent-bound Ez registry, not a host launcher:

```sh
ez plugins inspect resend --source /reviewed/ez-resend
ez plugins catalog-add resend --source /reviewed/ez-resend --revision sha256:REVIEWED
ez plugins install resend
ez plugins start resend
printf '%s' '{"apiKey":"...","recipient":"scouts@example.com"}' | ez resend init
ez resend doctor
```

The API key is supplied only over stdin and is written as a `0600` private profile
in the Docker volume. A successful doctor performs a read-only receiving-list
request. A running container alone does not prove provider access.

The service polls only the configured recipient every 15 minutes and persists
each matching message once by Resend ID and body hash. `receiving poll` remains
an explicit bounded diagnostic read; it is not the scheduler. The owning agent
claims one packet with its run ID, saves its domain result, then acknowledges the
exact claim. `status` and `receipt ID` expose captured or interrupted work;
there is no automatic claim replay. An ID whose body changes fails closed.

Received content is untrusted. The agent consuming output decides routing and
records its own outcome. The service exposes a local event protocol for an Ez
host that elects to mount and register it, but it does not embed host, agent, or
domain behavior. There are no webhooks, outgoing email, Docker socket, or
credentials in repository files.

This is a beta release. Offline tests and Docker manager checks validate the
package boundary; live acceptance requires an authorized Resend account, a
read-only `doctor`, and service receipt capture on the target agent.
