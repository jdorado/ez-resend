import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main} from '../src/cli.mjs';
import {client} from '../src/client.mjs';
import {serve} from '../src/service.mjs';
import {capture, writePrivate} from '../src/store.mjs';

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
  assert.equal((await main(['receiving', 'list', '--start', '2026-09-11T00:00:00Z', '--end', '2026-09-11T00:00:00Z'], stream({}), {socketPath})).receipts[0].id, 'one');
});

test('retained packet discovery includes all states and never reads provider or changes receipts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-list-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const receiptsDirectory = join(root, 'receipts');
  let calls = 0;
  const options = {profile: join(root, 'missing-profile.json'), receiptsDirectory, fetcher: async () => { calls += 1; throw Error('Provider must not be read'); }};
  assert.deepEqual(await main(['receiving', 'list'], stream({}), options), {total: 0, truncated: false, undated: 0, unreadable: 0, receipts: []});
  const fixtures = [
    ['captured', 'captured', '2026-09-29T09:00:00Z'],
    ['processing', 'processing', '2026-09-30T08:00:00Z'],
    ['processed', 'processed', '2026-09-30T09:00:00Z'],
    ['later', 'captured', '2026-09-30T09:00:01Z'],
    ['undated', 'captured', null],
  ];
  for (const [id, state, receivedAt] of fixtures) {
    const {receipt} = await capture(receiptsDirectory, {id, receivedAt, from: 'Source', subject: `Packet ${id}`, text: 'Private body', html: '<p>Private body</p>', recipients: ['private@example.com']});
    await writePrivate(join(receiptsDirectory, `${id}.json`), {...receipt, state});
  }
  const before = await Promise.all(fixtures.map(([id]) => readFile(join(receiptsDirectory, `${id}.json`), 'utf8')));
  const args = ['receiving', 'list', '--start', '2026-09-29T09:00:00Z', '--end', '2026-09-30T09:00:00.000Z'];
  const listed = await main([...args, '--limit', '2'], stream({}), options);
  assert.equal(listed.total, 3);
  assert.equal(listed.truncated, true);
  assert.equal(listed.undated, 1);
  assert.deepEqual(listed.receipts.map(row => [row.id, row.state]), [['processed', 'processed'], ['processing', 'processing']]);
  assert.equal(JSON.stringify(listed).includes('Private body'), false);
  assert.equal(JSON.stringify(listed).includes('private@example.com'), false);
  const full = await main([...args, '--limit', '50'], stream({}), options);
  assert.equal(full.truncated, false);
  assert.equal(full.receipts[2].id, 'captured');
  assert.equal(full.receipts[0].bodySha256, JSON.parse(before[2]).bodySha256);
  assert.equal((await main(['receipt', full.receipts[0].id], stream({}), options)).message.text, 'Private body');
  assert.deepEqual(await Promise.all(fixtures.map(([id]) => readFile(join(receiptsDirectory, `${id}.json`), 'utf8'))), before);
  assert.equal(calls, 0);
  for (const invalid of [['--limit', '51'], ['--start', '2026-02-30T00:00:00Z'], ['--start', '2026-09-30'], ['--end'], ['--limit', '2', '--limit', '3'], ['--start', '2026-10-01T00:00:00Z', '--end', '2026-09-30T00:00:00Z']]) {
    await assert.rejects(main(['receiving', 'list', ...invalid], stream({}), options));
  }
  assert.equal(calls, 0);
});

test('list bounds from and subject so one oversized receipt cannot flood output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-bound-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const receiptsDirectory = join(root, 'receipts');
  const options = {profile: join(root, 'missing.json'), receiptsDirectory, fetcher: async () => { throw Error('Provider must not be read'); }};
  await capture(receiptsDirectory, {id: 'huge', receivedAt: '2026-09-30T00:00:00.000Z', from: `Big ${'f'.repeat(1024 * 1024)}`, subject: 'S'.repeat(1024 * 1024), text: '', html: '', recipients: []});
  const listed = await main(['receiving', 'list'], stream({}), options);
  assert.equal(listed.receipts[0].subject.length, 200);
  assert.equal(listed.receipts[0].from.length, 200);
  assert.ok(JSON.stringify(listed).length < 2000);
  assert.equal((await main(['receipt', 'huge'], stream({}), options)).message.subject.length, 1024 * 1024);
});

test('list skips corrupt receipt files and reports unreadable while claim, status, and events fail closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-corrupt-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const receiptsDirectory = join(root, 'receipts');
  const options = {profile: join(root, 'missing.json'), receiptsDirectory, fetcher: async () => { throw Error('Provider must not be read'); }};
  await capture(receiptsDirectory, {id: 'good', receivedAt: '2026-09-30T00:00:00.000Z', from: 'Source', subject: 'Good', text: '', html: '', recipients: []});
  const {receipt} = await capture(receiptsDirectory, {id: 'cut', receivedAt: '2026-09-30T00:00:01.000Z', from: 'Source', subject: 'Cut', text: '', html: '', recipients: []});
  await writeFile(join(receiptsDirectory, 'cut.json'), JSON.stringify(receipt).slice(0, 40));
  await writeFile(join(receiptsDirectory, 'empty.json'), '');
  await writeFile(join(receiptsDirectory, 'null.json'), 'null\n');
  await writeFile(join(receiptsDirectory, 'wrong.json'), `${JSON.stringify({...receipt, id: 'other'})}\n`);
  const listed = await main(['receiving', 'list'], stream({}), options);
  assert.deepEqual(listed.receipts.map(row => row.id), ['good']);
  assert.equal(listed.total, 1);
  assert.equal(listed.unreadable, 4);
  const goodBefore = await readFile(join(receiptsDirectory, 'good.json'), 'utf8');
  await assert.rejects(main(['receiving', 'claim', '--run-id', 'run_one'], stream({}), options), SyntaxError);
  await assert.rejects(main(['status'], stream({}), options), SyntaxError);
  await assert.rejects(main(['events-head'], stream({}), options), SyntaxError);
  assert.equal(await readFile(join(receiptsDirectory, 'good.json'), 'utf8'), goodBefore);
});

test('a provider message without created_at is undated and never lands in a date window', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-undated-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const details = {one: {...detail('one'), created_at: undefined}};
  const mock = provider(details);
  const options = {profile: join(root, 'connection.json'), receiptsDirectory: join(root, 'receipts'), fetcher: mock.fetcher, origin: 'https://resend.test'};
  await main(['init'], stream({apiKey: 're_test_0123456789abcdef', recipient: 'scouts@example.com'}), options);
  assert.equal((await main(['receiving', 'get', 'one'], stream({}), options)).receivedAt, null);
  assert.equal((await main(['receiving', 'poll'], stream({}), options)).captured, 1);
  assert.equal((await main(['receiving', 'poll'], stream({}), options)).captured, 0);
  const now = new Date().toISOString();
  const windowed = await main(['receiving', 'list', '--start', '2020-01-01T00:00:00Z', '--end', now], stream({}), options);
  assert.equal(windowed.total, 0);
  assert.equal(windowed.undated, 1);
  const open = await main(['receiving', 'list'], stream({}), options);
  assert.equal(open.receipts[0].receivedAt, null);
  assert.equal((await main(['events', '0'], stream({}), options)).events[0].receivedAt, Date.parse((await main(['receipt', 'one'], stream({}), options)).capturedAt));
});

test('a legacy receipt without state is listed and counted as captured', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-legacy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const receiptsDirectory = join(root, 'receipts');
  const options = {profile: join(root, 'missing.json'), receiptsDirectory, fetcher: async () => { throw Error('Provider must not be read'); }};
  const {receipt} = await capture(receiptsDirectory, {id: 'legacy', receivedAt: '2026-09-30T00:00:00.000Z', from: 'Source', subject: 'Legacy', text: '', html: '', recipients: []});
  const {state, claimedBy, processedAt, ...legacy} = receipt;
  await writePrivate(join(receiptsDirectory, 'legacy.json'), legacy);
  assert.equal('state' in JSON.parse(await readFile(join(receiptsDirectory, 'legacy.json'), 'utf8')), false);
  assert.deepEqual((await main(['receiving', 'list'], stream({}), options)).receipts.map(row => [row.id, row.state]), [['legacy', 'captured']]);
  assert.equal((await main(['status'], stream({}), options)).states.captured, 1);
  assert.equal((await main(['receiving', 'claim', '--run-id', 'run_one'], stream({}), options)).receipt.state, 'processing');
});

test('stray arguments to receiving list are rejected in process and through the service', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ez-resend-stray-'));
  const socketPath = join(root, 'state', 'service.sock');
  const options = {profile: join(root, 'connection.json'), receiptsDirectory: join(root, 'receipts'), socketPath, fetcher: async () => { throw Error('Provider must not be read'); }};
  const running = await serve(options);
  t.after(async () => { await running.close(); await rm(root, {recursive: true, force: true}); });
  for (const stray of [['foo'], ['--limit', '2', 'foo'], ['foo', 'bar'], ['--limit', '2', '--limit']]) {
    await assert.rejects(main(['receiving', 'list', ...stray], stream({}), options), /Use `receiving list/);
    await assert.rejects(main(['receiving', 'list', ...stray], stream({}), {socketPath}), /Use `receiving list/);
  }
  assert.equal((await main(['receiving', 'list'], stream({}), {socketPath})).total, 0);
});
