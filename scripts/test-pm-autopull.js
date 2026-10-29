// BWI-37 tests: `node scripts/test-pm-autopull.js`. Runs the engine with a fake Claude that never finishes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

function make(workers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi37-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: () => new Promise(() => {}) };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  E.workers = workers.map((cap, i) => ({ id: 'w' + i, name: 'W' + i, species: 'bunny', specialty: cap === 'code' ? 'Coder' : 'Writer of copy', capability: cap }));
  E.concurrency = 12;
  const p = E.upsert('projects', { id: 'p1', name: 'P', key: 'P', seq: 0, createdAt: 1 });
  return { E, p };
}
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };
const status = (E, t) => E.taskById(t.id).status;

(async () => {
  await test('off by default; nothing picked', () => {
    const { E, p } = make(['text']);
    assert.strictEqual(E.autoPull, false);
    assert.strictEqual(E.factoryDoc().autoPull, false);
    const t = E.makeTask(p, { title: 'A', status: 'backlog' });
    assert.strictEqual(E.autoPullBacklog().length, 0);
    assert.strictEqual(status(E, t), 'backlog');
  });
  await test('no idle workers: nothing picked', () => {
    const { E, p } = make(['text']);
    E.makeTask(p, { title: 'Busy', status: 'todo' });
    const busy = E.makeTask(p, { title: 'Busy2', status: 'todo' });
    E.sendTask(busy.id); // occupies the only worker
    const t = E.makeTask(p, { title: 'A', status: 'backlog' });
    E.autoPull = true;
    assert.strictEqual(E.autoPullBacklog().length, 0);
    assert.strictEqual(status(E, t), 'backlog');
  });
  await test('empty Backlog: nothing picked', () => {
    const { E, p } = make(['text', 'text']);
    E.makeTask(p, { title: 'In to do', status: 'todo' });
    E.autoPull = true;
    assert.strictEqual(E.autoPullBacklog().length, 0);
    assert.strictEqual(E.jobs.length, 0);
  });
  await test('more idle workers than tickets: only the tickets are picked, with a note', () => {
    const { E, p } = make(['text', 'text', 'text']);
    const a = E.makeTask(p, { title: 'A', status: 'backlog' });
    const b = E.makeTask(p, { title: 'B', status: 'backlog' });
    E.autoPull = true;
    const picks = E.autoPullBacklog();
    assert.strictEqual(picks.length, 2);
    for (const t of [a, b]) {
      assert.strictEqual(status(E, t), 'progress');
      assert.ok(E.taskById(t.id).desc.includes('Picked by PM auto-pull'));
    }
  });
  await test('never more tickets than idle workers; highest priority first', () => {
    const { E, p } = make(['text', 'text']);
    const low = E.makeTask(p, { title: 'Low', status: 'backlog', priority: 'low' });
    const urgent = E.makeTask(p, { title: 'Urgent', status: 'backlog', priority: 'urgent' });
    const high = E.makeTask(p, { title: 'High', status: 'backlog', priority: 'high' });
    E.autoPull = true;
    E.autoPullBacklog();
    assert.strictEqual(status(E, urgent), 'progress');
    assert.strictEqual(status(E, high), 'progress');
    assert.strictEqual(status(E, low), 'backlog');
  });
  await test('skips tickets blocked by an unfinished dependency', () => {
    const { E, p } = make(['text', 'text']);
    const dep = E.makeTask(p, { title: 'Dep', status: 'review' });
    const blocked = E.makeTask(p, { title: 'Blocked', status: 'backlog', priority: 'urgent' });
    E.taskById(blocked.id).deps = ['P-' + dep.n];
    const free = E.makeTask(p, { title: 'Free', status: 'backlog' });
    E.autoPull = true;
    E.autoPullBacklog();
    assert.strictEqual(status(E, blocked), 'backlog');
    assert.strictEqual(status(E, free), 'progress');
  });
  await test('job queue not empty: nothing picked', () => {
    const { E, p } = make(['text']);
    E.claude.exe = () => ''; // jobs stay queued
    const q = E.makeTask(p, { title: 'Q', status: 'todo' });
    E.sendTask(q.id);
    const t = E.makeTask(p, { title: 'A', status: 'backlog' });
    E.autoPull = true;
    assert.strictEqual(E.autoPullBacklog().length, 0);
    assert.strictEqual(status(E, t), 'backlog');
  });
  await test('setting persists via setFactory', () => {
    const { E } = make(['text']);
    E.setFactory({ autoPull: true });
    assert.strictEqual(E.factoryDoc().autoPull, true);
  });
  console.log(fails ? 'SOME TESTS FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
