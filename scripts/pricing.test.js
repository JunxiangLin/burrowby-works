// BWI-20: unit tests for the price table. Run: node scripts/pricing.test.js
const assert = require('assert');
const { estimateCost, PRICES } = require('../src/pricing');

assert.strictEqual(estimateCost('claude-haiku-5-5', 1e6, 1e6), 6, 'haiku 1+5 per M');
assert.strictEqual(estimateCost('claude-sonnet-5-5', 1e6, 0), 3);
assert.strictEqual(estimateCost('CLAUDE-OPUS-5', 0, 1e6), 75, 'case-insensitive match');
assert.strictEqual(estimateCost('claude-haiku-5-5', 0, 0), null, 'no tokens -> no cost');
assert.strictEqual(estimateCost('claude-haiku-5-5', undefined, undefined), null);
assert.strictEqual(estimateCost(undefined, 10, 10), null, 'missing model -> no cost');
assert.strictEqual(estimateCost('gpt-x', 10, 10), null, 'unknown model -> no cost');
assert.ok(estimateCost('claude-haiku-5-5', 0, 5) > 0, 'output-only tokens still priced');
assert.ok(Array.isArray(PRICES) && PRICES.length >= 3);
console.log('OK: pricing');
