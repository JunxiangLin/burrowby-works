// Offline check of the owner digest builder.
const assert = require('assert');
const { buildDigest } = require('../src/digest');

const now = Date.now();
const H = 3600 * 1000;
const job = (n, o) => ({ n, text: `job ${n}`, createdAt: now - 2 * H, ...o });

// Empty factory: no sections.
assert.strictEqual(buildDigest({ now }).empty, true);

const d = buildDigest({
  now,
  jobs: [
    job(1, { status: 'done', finishedAt: now - H }),
    job(2, { status: 'done', finishedAt: now - 30 * H }), // too old
    job(3, { status: 'failed', finishedAt: now - H }),
    job(4, { status: 'running', startedAt: now - 30 * H }), // aged past threshold
    job(5, { status: 'running', startedAt: now - H }), // fine
  ],
  tasks: [{ title: 'Review me', status: 'review' }, { title: 'Other', status: 'todo' }],
  taskKey: () => 'T-1',
});
assert.deepStrictEqual(d.sections.map((s) => s.id), ['shipped', 'stuck', 'needs']);
assert.strictEqual(d.sections[0].total, 1);
assert.strictEqual(d.sections[1].total, 2);
assert.strictEqual(d.sections[2].items[0], 'T-1 Review me');

// Empty sections are hidden; long sections are capped with a "more" count.
const only = buildDigest({ now, jobs: Array.from({ length: 5 }, (_, i) => job(i, { status: 'done', finishedAt: now - H })) });
assert.deepStrictEqual(only.sections.map((s) => s.id), ['shipped']);
assert.strictEqual(only.sections[0].items.length, 3);
assert.strictEqual(only.sections[0].more, 2);

console.log('digest check ok');
