// BWI-17 tests: `node scripts/test-pm-autoaccept.js`. Runs the engine with a fake Claude.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

const reply = (titles) => 'Notes.\n```json\n' + JSON.stringify({ tickets: titles.map((t) => ({ title: t, description: 'd ' + t, priority: 'high' })) }) + '\n```';
function make(output) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi17-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: async () => ({ text: output, stopReason: 'end_turn' }) };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  E.workers = [E.workers[0]];
  E.workers[0].capability = 'pm';
  const p = E.upsert('projects', { id: 'p1', name: 'P', key: 'P', seq: 0, createdAt: 1 });
  return { E, p };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runPm(E, extra) {
  const j = E.createJob('plan', 'any', 'default', extra);
  for (let i = 0; i < 100 && !['done', 'failed'].includes(j.status); i++) await wait(20);
  assert.strictEqual(j.status, 'done');
  return j;
}
const titles = (E) => E.tasks.map((t) => t.title);
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

(async () => {
  await test('default is on', async () => { assert.strictEqual(make('x').E.autoAcceptPm, true); assert.strictEqual(make('x').E.factoryDoc().autoAcceptPm, true); });
  await test('on: tickets land on backlog with job note', async () => {
    const { E } = make(reply(['A', 'B']));
    const j = await runPm(E, { projectId: 'p1' });
    assert.deepStrictEqual(titles(E).sort(), ['A', 'B']);
    for (const t of E.tasks) { assert.strictEqual(t.status, 'backlog'); assert.ok(t.desc.includes(`Created by job #${j.n}.`)); }
    assert.ok(j.proposals.every((x) => x.accepted));
  });
  await test('on: duplicate titles skipped (existing + in-batch, case-insensitive)', async () => {
    const { E, p } = make(reply(['Alpha', ' alpha ', 'Beta', 'beta']));
    E.makeTask(p, { title: 'ALPHA', status: 'todo' });
    await runPm(E, { projectId: 'p1' });
    assert.deepStrictEqual(titles(E).sort(), ['ALPHA', 'Beta']);
  });
  await test('on: no project leaves proposals pending', async () => {
    const { E } = make(reply(['A']));
    const j = await runPm(E);
    assert.strictEqual(E.tasks.length, 0);
    assert.strictEqual(j.proposals[0].accepted, false);
  });
  await test('off: nothing auto-created, manual accept works', async () => {
    const { E } = make(reply(['A', 'B']));
    E.setFactory({ autoAcceptPm: false });
    assert.strictEqual(E.factoryDoc().autoAcceptPm, false);
    const j = await runPm(E, { projectId: 'p1' });
    assert.strictEqual(E.tasks.length, 0);
    const added = E.acceptProposals(j.id);
    assert.strictEqual(added.length, 2);
    assert.ok(E.tasks.every((t) => t.status === 'backlog' && t.desc.includes('Created by job')));
  });
  await test('setting persists across reload', async () => {
    const { E } = make('x');
    E.setFactory({ autoAcceptPm: false });
    E.saveNow = Engine.prototype.saveNow; E.saveNow();
    assert.strictEqual(new Engine({ dir: E.dir, claude: E.claude }).autoAcceptPm, false);
  });
  console.log(fails ? 'SOME TESTS FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
