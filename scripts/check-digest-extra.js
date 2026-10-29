// QA extra checks for the owner digest builder (BWI-26).
const assert = require('assert');
const { buildDigest } = require('../src/digest');

const now = Date.now();
const H = 3600 * 1000;

// Failed job inside the window is stuck; failed older than 24h is not.
let d = buildDigest({ now, jobs: [
  { n: 1, text: 'a', status: 'failed', finishedAt: now - H },
  { n: 2, text: 'b', status: 'failed', finishedAt: now - 40 * H },
] });
assert.strictEqual(d.sections.length, 1);
assert.strictEqual(d.sections[0].id, 'stuck');
assert.strictEqual(d.sections[0].total, 1);

// Blocked merge counts as stuck.
d = buildDigest({ now, jobs: [{ n: 3, text: 'c', status: 'done', finishedAt: now - 50 * H, merge: { status: 'blocked', at: now - H } }] });
assert.deepStrictEqual(d.sections.map((s) => s.id), ['stuck']);

// Queued job older than threshold is stuck; custom threshold respected.
d = buildDigest({ now, stuckMs: H, jobs: [{ n: 4, text: 'd', status: 'queued', createdAt: now - 2 * H }] });
assert.strictEqual(d.sections[0].total, 1);

// Only Review tasks need the owner; long titles are trimmed.
d = buildDigest({ now, taskKey: () => 'T-1', tasks: [{ title: 'x'.repeat(200), status: 'review' }, { title: 'y', status: 'done' }] });
assert.deepStrictEqual(d.sections.map((s) => s.id), ['needs']);
assert.ok(d.sections[0].items[0].length <= 60);

// Worst-case size: every section is capped at 3 lines.
const many = Array.from({ length: 20 }, (_, i) => ({ n: i, text: 'z', status: 'done', finishedAt: now - H }));
d = buildDigest({ now, jobs: many, tasks: many.map((j) => ({ title: 't', status: 'review' })) });
d.sections.forEach((s) => assert.ok(s.items.length <= 3));

console.log('digest extra check ok');
