// BW-1 tests: `node scripts/autosave.test.js`. Autosave persists across restarts and save failures are reported.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

const mk = (dir) => new Engine({ dir, claude: { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: () => new Promise(() => {}) } });
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bw1-'));
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

(async () => {
  await test('project, task, worker and job survive a restart (no export)', () => {
    const dir = tmpdir();
    const E = mk(dir);
    E.projects.push({ id: 'p1', name: 'Proj', key: 'PRJ', createdAt: 1 });
    E.tasks.push({ id: 't1', projectId: 'p1', title: 'Task one', createdAt: 1 });
    E.workers.push({ id: 'wx', name: 'Newbie', species: 'bunny', specialty: 'Writer', capability: 'text' });
    E.jobs.push({ id: 'j1', text: 'do it', status: 'done', output: 'the output', createdAt: 1 });
    assert.strictEqual(E.saveNow(), true);
    const R = mk(dir);
    assert.ok(R.projects.some((p) => p.id === 'p1'));
    assert.ok(R.tasks.some((t) => t.title === 'Task one'));
    assert.ok(R.workers.some((w) => w.id === 'wx'));
    const j = R.jobs.find((x) => x.id === 'j1');
    assert.ok(j && j.output === 'the output');
  });

  await test('debounced save() writes the file on its own', async () => {
    const dir = tmpdir();
    const E = mk(dir);
    E.projects.push({ id: 'p2', name: 'Auto', key: 'AUT', createdAt: 1 });
    E.save();
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(fs.readFileSync(path.join(dir, 'works.json'), 'utf8').includes('"p2"'));
  });

  await test('write failure emits plain-words save-error, returns false, then recovers with save-ok', () => {
    const dir = tmpdir();
    const E = mk(dir);
    const notes = [];
    E.on('notice', (n) => notes.push(n));
    const orig = fs.writeFileSync;
    fs.writeFileSync = () => { const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; };
    let r;
    try { r = E.saveNow(); } finally { fs.writeFileSync = orig; }
    clearTimeout(E.saveTimer);
    assert.strictEqual(r, false);
    const err = notes.find((n) => n.kind === 'save-error');
    assert.ok(err, 'no save-error notice');
    assert.ok(err.text.includes('ENOSPC') && err.text.includes('works.json'));
    assert.strictEqual(E.saveFailed, true);
    assert.strictEqual(E.saveNow(), true);
    assert.ok(notes.some((n) => n.kind === 'save-ok'));
    assert.strictEqual(E.saveFailed, false);
  });

  await test('failed save schedules a retry', () => {
    const dir = tmpdir();
    const E = mk(dir);
    const orig = fs.writeFileSync;
    fs.writeFileSync = () => { throw new Error('nope'); };
    try { E.saveNow(); } finally { fs.writeFileSync = orig; }
    assert.ok(E.saveTimer, 'retry timer not set');
    clearTimeout(E.saveTimer);
  });

  await test('corrupt works.json is backed up before autosave can overwrite it', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'works.json'), '{ not json');
    const E = mk(dir);
    E.saveNow();
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('works.json.corrupt-'));
    assert.strictEqual(backups.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{ not json');
  });

  if (fails) { console.log(fails + ' failed'); process.exit(1); }
  console.log('OK: autosave');
  process.exit(0);
})();
