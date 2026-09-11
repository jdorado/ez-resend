import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export const safeId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw Error('Invalid Resend message ID');
  return value;
};

export const digest = value => createHash('sha256').update(value).digest('hex');

export async function writePrivate(file, value) {
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {mode: 0o600, flag: 'wx'});
  await rename(temporary, file);
}

export async function readPrivate(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function capture(receiptsDirectory, message) {
  const id = safeId(message.id);
  const body = JSON.stringify(message);
  const bodySha256 = digest(body);
  const receipt = {id, bodySha256, capturedAt: new Date().toISOString(), state: 'captured', claimedBy: null, processedAt: null, message};
  const file = join(receiptsDirectory, `${id}.json`);
  try {
    await mkdir(receiptsDirectory, {recursive: true, mode: 0o700});
    await writeFile(file, `${JSON.stringify(receipt)}\n`, {mode: 0o600, flag: 'wx'});
    return {captured: true, receipt};
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = await readPrivate(file);
    if (prior.id !== id || prior.bodySha256 !== bodySha256) throw Error('Resend message ID changed; inspect before recovery');
    return {captured: false, receipt: prior};
  }
}

export async function receipts(receiptsDirectory) {
  try {
    const files = (await readdir(receiptsDirectory)).filter(file => /^[A-Za-z0-9_-]{1,180}\.json$/.test(file)).sort();
    return Promise.all(files.map(file => readPrivate(join(receiptsDirectory, file))));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function claim(receiptsDirectory, runId) {
  safeId(runId);
  const pending = (await receipts(receiptsDirectory))
    .filter(receipt => (receipt.state ?? 'captured') === 'captured')
    .sort((left, right) => String(left.capturedAt).localeCompare(String(right.capturedAt)) || left.id.localeCompare(right.id))[0];
  if (!pending) return null;
  const updated = {...pending, state: 'processing', claimedBy: runId, claimedAt: new Date().toISOString()};
  await writePrivate(join(receiptsDirectory, `${pending.id}.json`), updated);
  return updated;
}

export async function acknowledge(receiptsDirectory, id, runId) {
  safeId(id);
  safeId(runId);
  const file = join(receiptsDirectory, `${id}.json`);
  const receipt = await readPrivate(file);
  if ((receipt.state ?? 'captured') !== 'processing' || receipt.claimedBy !== runId) throw Error('Acknowledge requires the exact claiming run');
  const updated = {...receipt, state: 'processed', processedAt: new Date().toISOString()};
  await writePrivate(file, updated);
  return updated;
}
