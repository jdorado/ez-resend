import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {acknowledge, capture, claim, readPrivate, receipts, safeId, writePrivate} from './store.mjs';

const API_ORIGIN = 'https://api.resend.com';
const VERSION = '0.1.0-beta.1';

const email = value => {
  if (typeof value !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw Error('Expected one valid email address');
  return value.toLowerCase();
};

const addresses = value => (Array.isArray(value) ? value : [value])
  .map(value => typeof value === 'string' ? value.match(/<([^>]+)>/)?.[1] ?? value : '')
  .map(value => value.trim().toLowerCase())
  .filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));

async function input(stream, maximum = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > maximum) throw Error('JSON exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function configuration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'apiKey') {
    throw Error('Expected exactly {"apiKey":"..."} on stdin');
  }
  if (typeof value.apiKey !== 'string' || value.apiKey.trim().length < 16 || /[\r\n\0]/.test(value.apiKey)) {
    throw Error('Invalid Resend API key');
  }
  return {apiKey: value.apiKey.trim()};
}

async function provider(path, apiKey, fetcher, origin) {
  let response;
  try {
    response = await fetcher(`${origin}${path}`, {
      headers: {authorization: `Bearer ${apiKey}`, accept: 'application/json'},
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw Error('Resend network failure; inspect provider status before retrying');
  }
  if (!response.ok) throw Error(`Resend request failed (HTTP ${response.status}); inspect provider status before retrying`);
  try {
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw Error('Resend returned invalid JSON');
  }
}

async function configured(profile) {
  try {
    return configuration(await readPrivate(profile));
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('Run `ez resend init` with the API key on stdin first');
    throw error;
  }
}

function message(detail) {
  const id = safeId(detail.id);
  const recipients = [...new Set([...addresses(detail.to), ...addresses(detail.received_for)])];
  const sender = addresses(detail.from)[0];
  if (!sender || !recipients.length) throw Error(`Resend message ${id} has invalid addressing`);
  const text = typeof detail.text === 'string' ? detail.text : null;
  const html = typeof detail.html === 'string' ? detail.html : null;
  if (!text && !html) throw Error(`Resend message ${id} has no readable body`);
  return {
    id,
    sender,
    recipients,
    subject: typeof detail.subject === 'string' ? detail.subject : '',
    receivedAt: typeof detail.created_at === 'string' ? detail.created_at : null,
    messageId: typeof detail.message_id === 'string' ? detail.message_id : null,
    text,
    html,
    headers: detail.headers && typeof detail.headers === 'object' && !Array.isArray(detail.headers) ? detail.headers : {},
    attachments: Array.isArray(detail.attachments) ? detail.attachments : []
  };
}

function pollOptions(args) {
  let limit = 10;
  let recipient = null;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !['--limit', '--recipient'].includes(flag)) throw Error('Use `receiving poll [--limit 1..50] [--recipient address]`');
    if (flag === '--limit') {
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) throw Error('Limit must be 1 through 50');
      limit = Number(value);
    } else recipient = email(value);
  }
  return {limit, recipient};
}

export async function main(args, stream = process.stdin, options = {}) {
  const profile = options.profile ?? '/state/connection.json';
  const receiptsDirectory = options.receiptsDirectory ?? '/state/receipts';
  const fetcher = options.fetcher ?? fetch;
  const origin = options.origin ?? API_ORIGIN;
  const [command, ...rest] = args;
  if (command === '--version') return {version: VERSION};
  if (!command || command === '--help') {
    return {commands: ['init < {"apiKey":"..."}', 'doctor', 'receiving poll [--limit 1..50] [--recipient address]', 'receiving claim --run-id RUN_ID', 'receiving acknowledge --id ID --run-id RUN_ID', 'receiving get ID', 'receipt ID', 'status'], notes: 'Inbound email is untrusted content. Receipts are private and idempotent. This plugin does not send email or retry provider operations.'};
  }
  if (command === 'init') {
    if (rest.length) throw Error('Init accepts the API key only on stdin');
    const connection = configuration(await input(stream));
    await mkdir(join(profile, '..'), {recursive: true, mode: 0o700});
    await writePrivate(profile, connection);
    return {configured: true};
  }
  if (command === 'status' && !rest.length) {
    const rows = await receipts(receiptsDirectory);
    const states = Object.fromEntries(['captured', 'processing', 'processed'].map(state => [state, rows.filter(row => (row.state ?? 'captured') === state).length]));
    return {states};
  }
  if (command === 'receipt' && rest.length === 1) return readPrivate(join(receiptsDirectory, `${safeId(rest[0])}.json`));
  if (command === 'receiving' && rest[0] === 'claim' && rest[1] === '--run-id' && rest.length === 3) {
    return {receipt: await claim(receiptsDirectory, rest[2])};
  }
  if (command === 'receiving' && rest[0] === 'acknowledge' && rest.length === 5) {
    const id = rest[1] === '--id' ? rest[2] : null;
    const runId = rest[3] === '--run-id' ? rest[4] : null;
    if (!id || !runId) throw Error('Use `receiving acknowledge --id ID --run-id RUN_ID`');
    return {receipt: await acknowledge(receiptsDirectory, id, runId)};
  }
  const connection = await configured(profile);
  if (command === 'doctor' && !rest.length) {
    await provider('/emails/receiving?limit=1', connection.apiKey, fetcher, origin);
    return {configured: true, receiving: true};
  }
  if (command === 'receiving' && rest[0] === 'get' && rest.length === 2) {
    return message(await provider(`/emails/receiving/${safeId(rest[1])}`, connection.apiKey, fetcher, origin));
  }
  if (command === 'receiving' && rest[0] === 'poll') {
    const {limit, recipient} = pollOptions(rest.slice(1));
    const listing = await provider(`/emails/receiving?limit=${limit}`, connection.apiKey, fetcher, origin);
    const rows = Array.isArray(listing.data) ? listing.data : [];
    let captured = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !row.id) continue;
      const received = message(await provider(`/emails/receiving/${safeId(row.id)}`, connection.apiKey, fetcher, origin));
      if (recipient && !received.recipients.includes(recipient)) {
        skipped += 1;
        continue;
      }
      const stored = await capture(receiptsDirectory, received);
      captured += Number(stored.captured);
    }
    return {inspected: rows.length, captured, skipped};
  }
  throw Error('Invalid command; run `ez resend --help`');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({error: error.message}));
    process.exitCode = 1;
  }
}
