import {readPrivate} from './store.mjs';

export const API_ORIGIN = 'https://api.resend.com';

const email = value => {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw Error('Invalid receiving address');
  return value.toLowerCase();
};

export function configuration(value) {
  if (!value || typeof value !== 'object' || typeof value.apiKey !== 'string' || !/^re_[A-Za-z0-9_-]{12,}$/.test(value.apiKey)) throw Error('Expected JSON with a Resend API key');
  if (value.recipient !== undefined) value.recipient = email(value.recipient);
  if (value.pollSeconds !== undefined && (!Number.isSafeInteger(value.pollSeconds) || value.pollSeconds < 60 || value.pollSeconds > 86400)) throw Error('pollSeconds must be 60 through 86400');
  return {apiKey: value.apiKey, ...(value.recipient ? {recipient: value.recipient} : {}), pollSeconds: value.pollSeconds ?? 900};
}

export async function configured(profile) {
  try { return configuration(await readPrivate(profile)); }
  catch (error) { if (error.code === 'ENOENT') throw Error('Run `ez resend init` with private stdin JSON first'); throw error; }
}

export async function optionalConfiguration(profile) {
  try { return await configured(profile); } catch (error) { if (/Run `ez resend init/.test(error.message)) return null; throw error; }
}

export async function provider(path, apiKey, fetcher = fetch, origin = API_ORIGIN) {
  const response = await fetcher(`${origin}${path}`, {headers: {Authorization: `Bearer ${apiKey}`}});
  if (!response.ok) throw Error(`Resend receiving request failed (HTTP ${response.status})`);
  return response.json();
}

export function message(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') throw Error('Resend returned an invalid received message');
  const recipients = Array.isArray(value.to) ? value.to : typeof value.to === 'string' ? [value.to] : [];
  return {id: value.id, from: typeof value.from === 'string' ? value.from : '', recipients: recipients.filter(item => typeof item === 'string').map(item => item.toLowerCase()), subject: typeof value.subject === 'string' ? value.subject : '', text: typeof value.text === 'string' ? value.text : '', html: typeof value.html === 'string' ? value.html : '', receivedAt: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString()};
}

export function pollOptions(args) {
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

export function listOptions(args) {
  const options = {limit: 10, start: null, end: null};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !['--limit', '--start', '--end'].includes(flag) || seen.has(flag)) throw Error('Use `receiving list [--start UTC_ISO] [--end UTC_ISO] [--limit 1..50]`');
    seen.add(flag);
    if (flag === '--limit') {
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) throw Error('Limit must be 1 through 50');
      options.limit = Number(value);
    } else {
      const timestamp = Date.parse(value);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) throw Error('Dates must be valid UTC ISO timestamps');
      options[flag.slice(2)] = timestamp;
    }
  }
  if (options.start !== null && options.end !== null && options.start > options.end) throw Error('Start must not follow end');
  return options;
}
