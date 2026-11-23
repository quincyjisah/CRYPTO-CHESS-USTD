import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = lock.packages ?? {};

function assertVersionAtLeast(path, required) {
  const actual = packages[path]?.version;
  assert.ok(actual, `${path} must exist in the lockfile`);
  const a = actual.split('.').map(Number);
  const b = required.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return;
    if ((a[i] ?? 0) < (b[i] ?? 0)) {
      assert.fail(`${path} must be >= ${required}; resolved ${actual}`);
    }
  }
}

test('Hardhat build tooling resolves patched temporary-file, serializer and WebSocket dependencies', () => {
  assertVersionAtLeast('node_modules/tmp', '0.2.6');
  assertVersionAtLeast('node_modules/serialize-javascript', '7.1.3');
  assertVersionAtLeast('node_modules/ws', '8.21.0');
  assert.equal(packages['node_modules/@ethersproject/providers/node_modules/ws'], undefined, 'patched ws must be deduplicated to the root dependency');
});
