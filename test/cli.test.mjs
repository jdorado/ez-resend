import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main} from '../src/cli.mjs';
import {client} from '../src/client.mjs';
import {serve} from '../src/service.mjs';

const stream = value => Readable.from([JSON.stringify(value)]);
const detail = (id, to = 'scouts@example.com') => ({id, from: 'Source <source@example.org>', to, subject: `Scout ${id}`, created_at: '2026-09-11T00:00:00.000Z', message_id: `<${id}>`, text: `Body ${id}`, headers: {'authentication-results': 'dkim=pass'}, attachments: []});

function provider(details) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    const path = new URL(url).pathname;
    if (path === '/emails/receiving') return Response.json({data: Object.keys(details).map(id => ({id}))});
    const id = path.slice('/emails/receiving/'.length);
    if (details[id]) return Response.json(details[id]);
    return new Response('{}', {status: 404});
  };
  return {calls, fetcher};
}

test('init stores the key privately and poll captures only the explicit recipient once', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const profile = join(root, 'state', 'connection.json');
  const receiptsDirectory = join(root, 'state', 'receipts');
  const mock = provider({one: detail('one'), other: detail('other', 'other@example.com')});
  const options = {profile, receiptsDirectory, fetcher: mock.fetcher, origin: 'https://resend.test'};
  assert.deepEqual(await main(['init'], stream({apiKey: 're_test_0123456789abcdef', recipient: 'scouts@example.com'}), options), {configured: true, recipient: 'scouts@example.com', pollSeconds: 900});
  assert.equal((await stat(profile)).mode & 0o777, 0o600);
  assert.ok((await readFile(profile, 'utf8')).includes('re_test_0123456789abcdef'));
  const first = await main(['receiving', 'poll', '--limit', '2', '--recipient', 'scouts@example.com'], stream({}), options);
  assert.equal(first.inspected, 2);
  assert.equal(first.captured, 1);
  assert.equal(first.skipped, 1);
  const claimed = await main(['receiving', 'claim', '--run-id', 'scheduled_one'], stream({}), options);
  assert.equal(claimed.receipt.message.id, 'one');
  assert.equal((await main(['status'], stream({}), options)).states.processing, 1);
  await assert.rejects(main(['receiving', 'acknowledge', '--id', 'one', '--run-id', 'other_run'], stream({}), options), /exact claiming run/);
  const acknowledged = await main(['receiving', 'acknowledge', '--id', 'one', '--run-id', 'scheduled_one'], stream({}), options);
  assert.equal(acknowledged.receipt.state, 'processed');
  const second = await main(['receiving', 'poll', '--limit', '2', '--recipient', 'scouts@example.com'], stream({}), options);
  assert.equal(second.captured, 0);
  assert.equal((await main(['receipt', 'one'], stream({}), options)).message.subject, 'Scout one');
  assert.equal((await main(['events', '0'], stream({}), options)).events[0].id, 'one');
  assert.equal((await main(['events-check', 'one'], stream({}), options)).events[0].id, 'one');
  assert.equal(mock.calls.filter(call => call.options?.headers?.Authorization?.includes('re_test_')).length, 6);
});

test('provider failures hide the key and bad arguments fail before provider access', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-failure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const profile = join(root, 'connection.json');
  const options = {profile, receiptsDirectory: join(root, 'receipts'), origin: 'https://resend.test', fetcher: async () => new Response('private key re_secret', {status: 401})};
  await main(['init'], stream({apiKey: 're_test_0123456789abcdef', recipient: 'scouts@example.com'}), options);
  await assert.rejects(main(['doctor'], stream({}), options), error => !error.message.includes('re_secret') && /HTTP 401/.test(error.message));
  await assert.rejects(main(['receiving', 'poll', '--limit', '99'], stream({}), options), /Limit must be 1 through 50/);
});

test('changed provider content for an existing Resend ID fails closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-changed-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const profile = join(root, 'connection.json');
  const receiptsDirectory = join(root, 'receipts');
  const details = {one: detail('one')};
  const mock = provider(details);
  const options = {profile, receiptsDirectory, fetcher: mock.fetcher, origin: 'https://resend.test'};
  await main(['init'], stream({apiKey: 're_test_0123456789abcdef', recipient: 'scouts@example.com'}), options);
  await main(['receiving', 'poll'], stream({}), options);
  details.one = {...details.one, text: 'Changed body'};
  await assert.rejects(main(['receiving', 'poll'], stream({}), options), /message ID changed/);
});

test('resident Docker-service shape captures independently and exposes event reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-service-'));
  const profile = join(root, 'state', 'connection.json');
  const receiptsDirectory = join(root, 'state', 'receipts');
  const socketPath = join(root, 'state', 'service.sock');
  const mock = provider({one: detail('one')});
  const options = {profile, receiptsDirectory, socketPath, fetcher: mock.fetcher, origin: 'https://resend.test'};
  t.after(async () => { await running.close(); await rm(root, {recursive: true, force: true}); });
  await main(['init'], stream({apiKey: 're_test_0123456789abcdef', recipient: 'scouts@example.com'}), options);
  const running = await serve(options);
  assert.equal((await client(socketPath, 'status')).states.captured, 1);
  assert.deepEqual(await client(socketPath, 'events-head'), {cursor: 1});
  assert.equal((await client(socketPath, 'events', {after: 0})).events[0].id, 'one');
});
