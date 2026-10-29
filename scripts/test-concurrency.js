// BWI-46 tests: `node scripts/test-concurrency.js`. Scheduler honours "Jobs at once" up to the crew size.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

function make(nWorkers, dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'bwi46-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: () => new Promise(() => {}) };
  const E = new Engine({ dir, claude });
  E.workers = Array.from({ length: nWorkers }, (_, i) => ({ id: 'w' + i, name: 'W' + i, species: 'bunny', specialty: 'Writer', capability: 'text' }));
  return { E, dir };
}
const running = (E) => E.jobs.filter((j) => j.status === 'running').length;
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

(async () => {
  for (const n of [1, 3, 4, 8, 12]) {
    await test(`with ${n} set, exactly ${n} of ${n + 2} jobs run at once`, () => {
      const { E } = make(12);
      E.setConcurrency(n);
      for (let i = 0; i < n + 2; i++) E.createJob('Job ' + i, 'any', 'default');
      assert.strictEqual(running(E), n);
      assert.strictEqual(E.jobs.filter((j) => j.status === 'queued').length, 2);
    });
  }
  await test('raising the setting starts queued jobs immediately', () => {
    const { E } = make(12);
    E.setConcurrency(2);
    for (let i = 0; i < 6; i++) E.createJob('Job ' + i, 'any', 'default');
    assert.strictEqual(running(E), 2);
    E.setConcurrency(5);
    assert.strictEqual(running(E), 5);
  });
  await test('lowering never stops running jobs', () => {
    const { E } = make(12);
    E.setConcurrency(6);
    for (let i = 0; i < 6; i++) E.createJob('Job ' + i, 'any', 'default');
    E.setConcurrency(2);
    assert.strictEqual(running(E), 6);
  });
  await test('cannot exceed hired workers, below 1, or fractional: clear message', () => {
    const { E } = make(5);
    E.setConcurrency(5);
    assert.throws(() => E.setConcurrency(6), /1 to 5.*5 hired workers/);
    assert.throws(() => E.setConcurrency(0), /1 to 5/);
    assert.throws(() => E.setConcurrency(-1), /1 to 5/);
    assert.throws(() => E.setConcurrency(1.5), /whole number/);
    assert.strictEqual(E.concurrency, 5);
    const big = make(12).E;
    assert.throws(() => big.setConcurrency(13), /1 to 12/);
  });
  await test('setFactory rejects a bad value and keeps the old one', () => {
    const { E } = make(4);
    E.setConcurrency(3);
    E.setFactory({ concurrency: 9 });
    assert.strictEqual(E.concurrency, 3);
    E.setFactory({ concurrency: 4 });
    assert.strictEqual(E.concurrency, 4);
  });
  await test('retiring a worker clamps the setting to the crew', () => {
    const { E } = make(4);
    E.setConcurrency(4);
    assert.ok(E.retireWorker('w3').ok);
    assert.strictEqual(E.concurrency, 3);
  });
  await test('value persists across restarts', () => {
    const { E, dir } = make(12);
    E.setConcurrency(9);
    E.saveNow();
    const again = new Engine({ dir, claude: E.claude });
    assert.strictEqual(again.concurrency, 9);
  });
  if (fails) { console.log(fails + ' failed'); process.exit(1); }
  console.log('OK: concurrency');
})();
