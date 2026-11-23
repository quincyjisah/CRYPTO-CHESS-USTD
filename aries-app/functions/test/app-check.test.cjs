const test = require('node:test');
const assert = require('node:assert/strict');
const { isAppCheckEnforced } = require('../lib/appCheck.js');

test('App Check enforcement is enabled only by an explicit true value', () => {
  assert.equal(isAppCheckEnforced('true'), true);
  assert.equal(isAppCheckEnforced('TRUE'), false);
  assert.equal(isAppCheckEnforced('1'), false);
  assert.equal(isAppCheckEnforced('false'), false);
  assert.equal(isAppCheckEnforced(undefined), false);
});
