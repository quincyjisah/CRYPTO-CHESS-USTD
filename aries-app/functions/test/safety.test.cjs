const test = require('node:test');
const assert = require('node:assert/strict');
const { isFreeOnlyTerms } = require('../lib/safety.js');

test('accepts only explicit zero-fee FREE tournament terms', () => {
  assert.equal(isFreeOnlyTerms(0, 'FREE'), true);
});

test('rejects positive tournament entry fees', () => {
  assert.equal(isFreeOnlyTerms(1, 'USDT'), false);
  assert.equal(isFreeOnlyTerms(10, 'FREE'), false);
});

test('rejects negative, non-finite and stringified fees', () => {
  assert.equal(isFreeOnlyTerms(-1, 'FREE'), false);
  assert.equal(isFreeOnlyTerms(Number.NaN, 'FREE'), false);
  assert.equal(isFreeOnlyTerms(Number.POSITIVE_INFINITY, 'FREE'), false);
  assert.equal(isFreeOnlyTerms('0', 'FREE'), false);
});

test('rejects currency labels other than FREE', () => {
  assert.equal(isFreeOnlyTerms(0, 'USDT'), false);
  assert.equal(isFreeOnlyTerms(0, 'USDC'), false);
  assert.equal(isFreeOnlyTerms(0, 'DAI'), false);
});
