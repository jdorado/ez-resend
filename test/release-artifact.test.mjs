import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {verifyArtifact} from '../scripts/verify-release-artifact.mjs';

test('publication accepts only exact independently reviewed bytes', () => {
  const bytes=Buffer.from('reviewed immutable candidate');
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifyArtifact(bytes,digest),digest);
  assert.throws(()=>verifyArtifact(Buffer.from('replacement'),digest),/does not match/);
  for (const invalid of [undefined,'','x'.repeat(64),digest+'\n'])
    assert.throws(()=>verifyArtifact(bytes,invalid),/reviewed SHA-256/);
});
