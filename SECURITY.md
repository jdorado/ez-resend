# Security

`ez-resend` is for trusted single-user Ez deployments. The API key and raw email
receipts remain in the plugin's private Docker volume. Do not add host mounts,
ports, a Docker socket, webhook listeners, or environment inheritance.

Inbound messages are untrusted content. They cannot authorize actions. The
plugin does not send mail or retry provider operations. Report vulnerabilities
privately to the repository owner; do not include keys or message bodies.
