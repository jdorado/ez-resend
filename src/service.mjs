import {createServer} from 'node:http';
import {mkdir, unlink} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {acknowledge, capture, claim, readPrivate, receipts, safeId} from './store.mjs';
import {configured, optionalConfiguration, pollOptions, provider, message} from './operations.mjs';

const states = rows => Object.fromEntries(['captured', 'processing', 'processed'].map(state => [state, rows.filter(row => (row.state ?? 'captured') === state).length]));
const event = (receipt, index) => ({id: receipt.id, conversationId: 'resend', receivedAt: Date.parse(receipt.message.receivedAt) || Date.parse(receipt.capturedAt), text: `New Resend email receipt ${receipt.id}. Inspect it with ez resend receipt ${receipt.id}. From: ${receipt.message.from || 'unknown'}. Subject: ${receipt.message.subject || '(none)'}.`});

export async function poll(receiptsDirectory, connection, fetcher, origin, limit = 10, recipient = connection.recipient) {
  if (!recipient) throw Error('Run `ez resend init` with a receiving recipient before polling');
  const listing = await provider(`/emails/receiving?limit=${limit}`, connection.apiKey, fetcher, origin);
  const rows = Array.isArray(listing.data) ? listing.data : [];
  let captured = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !row.id) continue;
    const received = message(await provider(`/emails/receiving/${safeId(row.id)}`, connection.apiKey, fetcher, origin));
    if (!received.recipients.includes(recipient)) { skipped += 1; continue; }
    captured += Number((await capture(receiptsDirectory, received)).captured);
  }
  return {inspected: rows.length, captured, skipped};
}

export async function command(name, args, options) {
  const rows = () => receipts(options.receiptsDirectory);
  if (name === 'health') return {service: 'ready'};
  if (name === 'status') return {states: states(await rows())};
  if (name === 'receipt' && args.length === 1) return readPrivate(join(options.receiptsDirectory, `${safeId(args[0])}.json`));
  if (name === 'claim' && args[0] === '--run-id' && args.length === 2) return {receipt: await claim(options.receiptsDirectory, args[1])};
  if (name === 'acknowledge' && args[0] === '--id' && args[2] === '--run-id' && args.length === 4) return {receipt: await acknowledge(options.receiptsDirectory, args[1], args[3])};
  if (name === 'events-head') return {cursor: (await rows()).length};
  if (name === 'events') {
    const after = args?.after;
    if (!Number.isSafeInteger(after) || after < 0) throw Error('Invalid event cursor');
    const all = await rows();
    return {cursor: all.length, events: all.slice(after, after + 10).map(event)};
  }
  if (name === 'events-check') {
    if (!Array.isArray(args?.ids)) throw Error('Invalid event IDs');
    const byId = new Map((await rows()).map(row => [row.id, row]));
    return {events: args.ids.filter(id => typeof id === 'string' && byId.has(id)).map(id => event(byId.get(id)))};
  }
  const connection = await configured(options.profile);
  if (name === 'doctor') { await provider('/emails/receiving?limit=1', connection.apiKey, options.fetcher, options.origin); return {configured: true, receiving: true, recipient: connection.recipient ?? null, pollSeconds: connection.pollSeconds}; }
  if (name === 'poll') {
    const {limit, recipient} = pollOptions(args);
    return poll(options.receiptsDirectory, connection, options.fetcher, options.origin, limit, recipient ?? connection.recipient);
  }
  if (name === 'get' && args.length === 1) return message(await provider(`/emails/receiving/${safeId(args[0])}`, connection.apiKey, options.fetcher, options.origin));
  throw Error('Invalid command; run `ez resend --help`');
}

export async function serve(options) {
  await mkdir(dirname(options.socketPath), {recursive: true, mode: 0o700});
  await unlink(options.socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  let timer;
  let closed = false;
  let lastPoll = {configured: false, captured: 0, error: null};
  const tick = async () => {
    try {
      const connection = await optionalConfiguration(options.profile);
      if (!connection?.recipient) { lastPoll = {configured: Boolean(connection), captured: 0, error: connection ? 'recipient-required' : null}; return; }
      const result = await poll(options.receiptsDirectory, connection, options.fetcher, options.origin);
      lastPoll = {configured: true, captured: result.captured, error: null};
    } catch (error) { lastPoll = {configured: true, captured: 0, error: error.message}; }
  };
  const server = createServer(async (request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 65536) request.destroy(); });
    request.on('end', async () => {
      try {
        const input = JSON.parse(body || '{}');
        const data = input.command === 'poller-status' ? {lastPoll} : await command(input.command, input.args ?? [], options);
        response.end(JSON.stringify({ok: true, data}));
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ok: false, error: error.message})); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.socketPath, resolve); });
  await tick();
  const connection = await optionalConfiguration(options.profile);
  timer = setInterval(() => void tick(), (connection?.pollSeconds ?? 900) * 1000);
  return {close: async () => { if (closed) return; closed = true; clearInterval(timer); await new Promise(resolve => server.close(resolve)); await unlink(options.socketPath).catch(() => {}); }};
}
