const test = require('node:test');
const assert = require('node:assert/strict');
const firebaseConfig = require('../../firebase.json');

test('Firebase deploy builds Cloud Functions and includes the compiled entrypoint', () => {
  const codebase = firebaseConfig.functions.find((entry) => entry.codebase === 'aries-functions');
  assert.ok(codebase, 'aries-functions codebase must exist');
  assert.ok(codebase.predeploy?.some((command) => command.includes('run build')));
  assert.equal(codebase.ignore.includes('lib'), false);
});
