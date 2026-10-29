// BWI-23: CI smoke test. Runs one fake ticket through board -> factory -> done
// with a stub model (no Claude CLI, no network, no Electron window).
// Every state transition is asserted; any break exits non-zero and fails CI.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-pipeline-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failNext = false;

const stubModel = {
  exe: () => 'stub',
  modelFor: () => 'stub-model',
  cwd: dir,
  stream(opts) {
    return new Promise((resolve, reject) => {
      if (failNext) { failNext = false; return reject(Object.assign(new Error('stub failure'), { code: 'upstream_error' })); }
      opts.onText('Stub');
      setTimeout(() => { opts.onText('Stub answer.'); resolve({ text: 'Stub answer.', stopReason: 'end_turn', inTok: 10, outTok: 2, model: opts.model }); }, 20);
    });
  },
  run: async () => ({ structured: {} }),
};

async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await wait(50); }
  assert.fail(`timed out waiting for: ${label}`);
}

const timer = setTimeout(() => { console.error('FAILED: smoke test exceeded 60s'); process.exit(1); }, 60000);

(async () => {
  const engine = new Engine({ dir, claude: stubModel });
  const project = engine.makeProject({ name: 'Smoke', key: 'SMK' });

  // Board: ticket starts in To do.
  const task = engine.makeTask(project, { title: 'Fake ticket', desc: 'Say hello.' });
  assert.strictEqual(engine.taskById(task.id).status, 'todo', 'ticket starts in todo');

  // Factory: sending it queues a job and moves the ticket to In progress.
  const job = engine.sendTask(task.id);
  assert.ok(job, 'sendTask returns a job');
  assert.strictEqual(engine.taskById(task.id).status, 'progress', 'ticket moves to progress');
  assert.ok(['queued', 'running'].includes(job.status), `job is active (${job.status})`);

  // Stub model ships the job; ticket lands in Review.
  await waitFor(() => job.status === 'done', 'job done');
  assert.strictEqual(job.output, 'Stub answer.');
  assert.strictEqual(job.model, 'stub-model');
  assert.strictEqual(engine.taskById(task.id).status, 'review', 'ticket moves to review when job ships');

  // Done: a person accepts it on the board.
  const t = engine.taskById(task.id);
  t.status = 'done';
  engine.upsert('tasks', t);
  assert.strictEqual(engine.taskById(task.id).status, 'done', 'ticket reaches done');

  // Failure path: a failed job must not advance the ticket.
  const t2 = engine.makeTask(project, { title: 'Doomed ticket' });
  failNext = true;
  const bad = engine.sendTask(t2.id);
  await waitFor(() => bad.status === 'failed', 'job failed');
  assert.strictEqual(engine.taskById(t2.id).status, 'progress', 'failed job leaves ticket in progress');

  // State survives a reload.
  engine.saveNow();
  const reloaded = new Engine({ dir, claude: stubModel });
  assert.strictEqual(reloaded.taskById(task.id).status, 'done', 'done state persisted');

  console.log('OK: ticket todo -> progress -> review -> done with stub model; failure path holds; state persists');
  clearTimeout(timer);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
