// BWI-34 tests: `node scripts/test-qa-routing.js`. QA jobs are unpinned and spread across free QA workers.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi34-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: async () => ({ text: 'ok', stopReason: 'end_turn' }) };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  E.concurrency = 10;
  E.workers = ['Sage', 'Hazel', 'Poppy'].map((name, i) => E.saveWorker({ id: 'q' + i, name, species: 'bunny', specialty: 's', capability: 'qa' }));
  E.workers.push(E.saveWorker({ id: 'c1', name: 'Biscuit', species: 'bear', specialty: 's', capability: 'code' }));
  E.runJob = (j, w) => { j.status = 'running'; j.workerId = w.id; }; // record the assignment only
  return E;
}
let fails = 0;
const test = (name, fn) => { try { fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

test('QA jobs spread across all free QA workers, never to the coder', () => {
  const E = make();
  const jobs = [1, 2, 3, 4].map((n) => E.createJob('verify ' + n, 'any', 'default', { qaFor: 'x' + n }));
  E.schedule();
  const ids = jobs.filter((j) => j.status === 'running').map((j) => j.workerId).sort();
  assert.deepStrictEqual(ids, ['q0', 'q1', 'q2']);
  assert.strictEqual(jobs[3].status, 'queued');
});
test('old job pinned to a busy QA worker is released to a free one', () => {
  const E = make();
  const busy = E.createJob('a', 'q0', 'default', { qaFor: 'x' });
  const pinned = E.createJob('b', 'q0', 'default', { qaFor: 'y' });
  E.schedule();
  assert.strictEqual(busy.workerId, 'q0');
  assert.notStrictEqual(pinned.workerId, 'q0');
  assert.strictEqual(pinned.status, 'running');
});
console.log(fails ? 'SOME TESTS FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
