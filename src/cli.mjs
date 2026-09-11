import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {client} from './client.mjs';
import {configuration} from './operations.mjs';
import {command, serve} from './service.mjs';
import {writePrivate} from './store.mjs';

const VERSION = '0.1.0-beta.2';
const input = async stream => { let body = ''; for await (const chunk of stream) body += chunk; try { return JSON.parse(body); } catch { throw Error('Expected JSON on stdin'); } };
const translate = args => {
  const [commandName, ...rest] = args;
  if (commandName === 'doctor' || commandName === 'status' || commandName === 'health') return [commandName, []];
  if (commandName === 'receipt' && rest.length === 1) return ['receipt', rest];
  if (commandName === 'receiving' && rest[0] === 'poll') return ['poll', rest.slice(1)];
  if (commandName === 'receiving' && rest[0] === 'get' && rest.length === 2) return ['get', [rest[1]]];
  if (commandName === 'receiving' && rest[0] === 'claim') return ['claim', rest.slice(1)];
  if (commandName === 'receiving' && rest[0] === 'acknowledge') return ['acknowledge', rest.slice(1)];
  if (commandName === 'events-head') return ['events-head', []];
  if (commandName === 'events') return ['events', {after: Number(rest[0])}];
  if (commandName === 'events-check') return ['events-check', {ids: rest}];
  throw Error('Invalid command; run `ez resend --help`');
};

export async function main(args, stream = process.stdin, options = {}) {
  const profile = options.profile ?? '/state/connection.json';
  const receiptsDirectory = options.receiptsDirectory ?? '/state/receipts';
  const socketPath = options.socketPath ?? '/state/service.sock';
  const context = {profile, receiptsDirectory, socketPath, fetcher: options.fetcher ?? fetch, origin: options.origin};
  const [commandName] = args;
  if (commandName === '--version') return {version: VERSION};
  if (!commandName || commandName === '--help') return {commands: ['init < {"apiKey":"...","recipient":"scouts@example.com"}', 'doctor', 'status', 'receiving poll [--limit 1..50] [--recipient address]', 'receiving claim --run-id RUN_ID', 'receiving acknowledge --id ID --run-id RUN_ID', 'receiving get ID', 'receipt ID'], service: 'The Docker service owns periodic receipt capture. Its event socket is portable for an Ez host to register; received content stays untrusted.'};
  if (commandName === 'init') {
    if (args.length !== 1) throw Error('Init accepts the API key and receiving recipient only on stdin');
    const connection = configuration(await input(stream));
    await mkdir(join(profile, '..'), {recursive: true, mode: 0o700});
    await writePrivate(profile, connection);
    return {configured: true, recipient: connection.recipient ?? null, pollSeconds: connection.pollSeconds};
  }
  if (commandName === 'serve') {
    if (!options.allowServe && !process.env.EZ_RESEND_SERVICE) throw Error('Start the registered Docker service with ez plugins start resend');
    const running = await serve(context);
    if (options.allowServe) return running;
    process.on('SIGTERM', () => void running.close());
    process.on('SIGINT', () => void running.close());
    return new Promise(() => {});
  }
  const [name, values] = translate(args);
  if (options.fetcher) return command(name, values, context);
  return client(socketPath, name, values);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
}
