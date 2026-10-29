// BWI-21: job history retention (500), costUsd persistence, and load time with 500 jobs.
// Run: node scripts/test-job-history.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-hist-'));
const claude = { exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir, stream: async () => ({ text: '' }), run: async () => ({ structured: {} }) };
const mk = (n, extra = {}) => ({ id: 'j_' + n, n, text: 'job ' + n, pref: 'any', tier: 'default', status: 'done', createdAt: n, startedAt: n, finishedAt: n + 1, output: 'x'.repeat(2000), projectId: 'p1', ...extra });

const e = new Engine({ dir, claude });
e.jobs = [];
for (let i = 1; i <= 520; i++) e.jobs.push(mk(i, i % 2 ? { costUsd: 0.0123 } : {}));
e.saveNow();

const t0 = Date.now();
const r = new Engine({ dir, claude });
const loadMs = Date.now() - t0;
assert.strictEqual(r.jobs.length, 500, 'retention keeps newest 500');
assert.strictEqual(r.jobs[0].n, 21, 'oldest 20 dropped');
assert.strictEqual(r.jobs[499].n, 520);
assert.strictEqual(r.jobs.find((j) => j.n === 519).costUsd, 0.0123, 'costUsd persists');
assert.strictEqual(r.jobs.find((j) => j.n === 520).costUsd, undefined, 'no cost stays blank');
assert.ok(loadMs < 2000, `load of 500 jobs took ${loadMs}ms`);

// Active jobs are never dropped by the in-memory cap.
const e2 = new Engine({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-hist-')), claude });
e2.jobs = [mk(1, { status: 'running' })];
for (let i = 2; i <= 560; i++) e2.jobs.push(mk(i));
e2.schedule = () => {};
e2.createJob('new');
assert.ok(e2.jobs.some((j) => j.id === 'j_1'), 'running job kept');
assert.ok(e2.jobs.length <= 501, 'in-memory cap applied, got ' + e2.jobs.length);
console.log(`OK: job history retention, costUsd persistence, 500-job load ${loadMs}ms`);
process.exit(0);
