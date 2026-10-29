// BWI-27 tests: `node scripts/test-audit-trail.js`. Per-ticket audit trail: recorded, newest first, append-only, text export.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi27-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: async () => ({ text: 'ok', stopReason: 'end_turn' }) };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  E.runJob = (j, w) => { j.status = 'running'; j.workerId = w.id; };
  const p = E.makeProject({ name: 'Proj', key: 'PRJ' });
  return { E, p };
}
let fails = 0;
const test = (name, fn) => { try { fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

test('creation is recorded with actor and timestamp', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', status: 'todo' });
  assert.strictEqual(t.audit.length, 1);
  assert.strictEqual(t.audit[0].type, 'created');
  assert.ok(t.audit[0].at > 0 && t.audit[0].actor);
});

test('UI save of a changed status/assignee is recorded; unchanged saves add nothing', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', status: 'todo' });
  const w = E.workers[0];
  E.upsert('tasks', JSON.parse(JSON.stringify({ ...E.taskById(t.id), status: 'progress', assignee: w.id })));
  const types = E.taskById(t.id).audit.map((a) => a.type);
  assert.deepStrictEqual(types, ['created', 'status', 'assignee']);
  E.upsert('tasks', JSON.parse(JSON.stringify(E.taskById(t.id))));
  assert.strictEqual(E.taskById(t.id).audit.length, 3);
});

test('append-only: a save cannot erase or rewrite history', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A' });
  const first = { ...E.taskById(t.id).audit[0] };
  E.upsert('tasks', { ...JSON.parse(JSON.stringify(E.taskById(t.id))), audit: [], status: 'review' });
  const a = E.taskById(t.id).audit;
  assert.deepStrictEqual(a[0], first);
  assert.strictEqual(a.length, 2);
  E.upsert('tasks', { ...JSON.parse(JSON.stringify(E.taskById(t.id))), audit: [{ at: 1, type: 'qa', actor: 'x', text: 'forged' }] });
  assert.ok(!E.taskById(t.id).audit.some((x) => x.text === 'forged'));
});

test('QA result and its status/assignee changes are recorded; retry is recorded', () => {
  const { E, p } = make();
  const coder = E.workers.find((w) => w.capability === 'code') || E.workers[0];
  const t = E.makeTask(p, { title: 'A', status: 'testing' });
  const cj = E.createJob('code', coder.id, 'default', { taskId: t.id, projectId: p.id });
  const qa = E.createJob('verify', 'any', 'default', { taskId: t.id, projectId: p.id, qaFor: cj.id });
  Object.assign(qa, { status: 'done', qa: { verdict: 'fail', notes: 'broken' } });
  E.onQaFinished(qa, E.taskById(t.id));
  const types = E.taskById(t.id).audit.map((a) => a.type);
  assert.ok(types.includes('qa'));
  assert.ok(E.taskById(t.id).audit.some((a) => a.type === 'status' && /Testing -> In progress/.test(a.text)));
  Object.assign(cj, { status: 'failed' });
  const nj = E.retryJob(cj.id);
  const ev = E.taskById(t.id).audit.filter((a) => a.type === 'retry');
  assert.strictEqual(ev.length, 1);
  assert.match(ev[0].text, new RegExp(`job #${nj.n}`));
});

test('text export lists events newest first', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', status: 'todo' });
  const live = E.taskById(t.id);
  live.audit = [
    { at: 1000, type: 'created', actor: 'You', text: 'event-one' },
    { at: 3000, type: 'status', actor: 'Foreman', text: 'event-three' },
    { at: 2000, type: 'assignee', actor: 'You', text: 'event-two' },
  ];
  const txt = E.auditText(t.id);
  assert.ok(txt.indexOf('event-three') < txt.indexOf('event-two') && txt.indexOf('event-two') < txt.indexOf('event-one'));
  assert.match(txt, /^Audit trail for PRJ-1/);
  assert.match(txt, /\[status\]  Foreman: event-three/);
  assert.strictEqual(E.auditText('nope'), null);
});

console.log(fails ? 'SOME TESTS FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
