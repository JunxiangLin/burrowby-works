// BWI-22 tests: `node scripts/test-output-validation.js`. PM output must contain a valid fenced JSON block.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

const good = 'Notes.\n```json\n{"tickets":[{"title":"A","description":"d","priority":"high"}]}\n```';
const bad = 'Here are some tickets: A, B, C';
function make(outputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi22-'));
  const calls = [];
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: async (o) => { calls.push(o.prompt); return { text: outputs[Math.min(calls.length - 1, outputs.length - 1)], stopReason: 'end_turn' }; } };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  E.workers = [E.workers[0]];
  E.workers[0].capability = 'pm';
  E.upsert('projects', { id: 'p1', name: 'P', key: 'P', seq: 0, createdAt: 1 });
  return { E, calls };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(E, extra) {
  const j = E.createJob('plan', 'any', 'default', extra);
  for (let i = 0; i < 100 && !['done', 'failed'].includes(j.status); i++) await wait(20);
  return j;
}
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

(async () => {
  await test('valid output: done, no extra call', async () => {
    const { E, calls } = make([good]);
    const j = await run(E, { projectId: 'p1' });
    assert.strictEqual(j.status, 'done');
    assert.strictEqual(calls.length, 1);
    assert.ok(!j.needsReview);
  });
  await test('malformed then fixed: one fix request, done', async () => {
    const { E, calls } = make([bad, good]);
    const j = await run(E, { projectId: 'p1' });
    assert.strictEqual(j.status, 'done');
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[1].includes('not valid'));
    assert.strictEqual(j.proposals.length, 1);
  });
  await test('malformed twice: never done, card flagged needs review', async () => {
    const { E, calls } = make([bad, bad]);
    const t = E.makeTask(E.projectById('p1'), { title: 'Plan', status: 'progress' });
    const j = await run(E, { projectId: 'p1', taskId: t.id });
    assert.strictEqual(calls.length, 2, 'asked exactly once');
    assert.notStrictEqual(j.status, 'done');
    assert.ok(j.needsReview);
    assert.strictEqual(t.status, 'review');
    assert.ok(t.labels.includes('needs review'));
    assert.strictEqual(E.tasks.length, 1, 'no tickets created');
  });
  console.log(fails ? 'SOME TESTS FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
