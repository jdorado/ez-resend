import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function verifyArtifact(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('Expected a reviewed SHA-256');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error('Packed artifact does not match reviewed bytes');
  return actual;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Supply artifact path and reviewed SHA-256');
  console.log(verifyArtifact(readFileSync(process.argv[2]), process.argv[3]));
}
