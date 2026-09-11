import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
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
  const receipt = {id, bodySha256, capturedAt: new Date().toISOString(), message};
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
