// BWI-19: retry creates a new job (new history entry) with the same inputs and a rising retry count.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-retry-'));
const fakeClaude = {
  exe: () => 'claude.exe',
  modelFor: () => 'm',
  cwd: dir,
  stream: () => new Promise(() => {}),
  run: async () => ({ structured: {} }),
};

(async () => {
  const engine = new Engine({ dir, claude: fakeClaude });
  const w = engine.workers[0];
  const orig = engine.createJob('Write a haiku', w.id, 'complex', { projectId: 'p1', taskId: 't1', ctx: ['c1'] });
  Object.assign(orig, { status: 'failed', error: 'upstream_error', errorDetail: 'x'.repeat(500), finishedAt: Date.now() });
  const before = engine.jobs.length;

  const r1 = engine.retryJob(orig.id);
  assert.notStrictEqual(r1.id, orig.id, 'retry is a new job');
  assert.strictEqual(engine.jobs.length, before + 1, 'new history entry');
  assert.ok(engine.jobById(orig.id), 'failed job stays in history');
  assert.strictEqual(r1.text, orig.text);
  assert.strictEqual(r1.tier, 'complex');
  assert.strictEqual(r1.projectId, 'p1');
  assert.strictEqual(r1.taskId, 't1');
  assert.deepStrictEqual(r1.ctx, ['c1']);
  assert.strictEqual(r1.retryOf, orig.id);
  assert.strictEqual(r1.retries, 1);

  Object.assign(r1, { status: 'failed', error: 'interrupted' });
  const r2 = engine.retryJob(r1.id);
  assert.strictEqual(r2.retries, 2, 'count goes up each retry');
  assert.strictEqual(r2.retryOf, r1.id);
  assert.strictEqual(engine.jobs.length, before + 2);
  assert.strictEqual(engine.retryJob('nope'), null);
  console.log('OK: retry creates new job, same inputs, retry count');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
