import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {encoding: 'utf8'}));
const files = pack.files.map(file => file.path);
for (const required of ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'Dockerfile', '.dockerignore', 'ez-plugin.json', 'ez-deployment.json']) {
  assert(files.includes(required), `Missing ${required}`);
}
for (const entry of pkg.files) assert(files.some(file => file === entry || file.startsWith(`${entry}/`)), `Declared package entry missing: ${entry}`);
for (const file of files) assert(!/(^|\/)(node_modules|\.git|\.env|\.private)(\/|$)|\.(tgz|log)$/.test(file), `Private package entry: ${file}`);
assert.equal(JSON.parse(readFileSync('ez-plugin.json', 'utf8')).version, pkg.version);
console.log(JSON.stringify({name: pkg.name, version: pkg.version, files}, null, 2));
