// BWI-24 tests: `node scripts/test-blocked.js`. Blocked = has a one-line reason; changes are logged.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine.js');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi24-'));
  const claude = { exe: () => 'fake', modelFor: () => 'm', cwd: dir, stream: async () => ({ text: 'ok', stopReason: 'end_turn' }) };
  const E = new Engine({ dir, claude });
  E.saveNow = () => {}; E.save = () => {};
  return { E, p: E.makeProject({ name: 'Proj', key: 'PRJ' }) };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const types = (t) => t.audit.map((a) => a.type);
let fails = 0;
const test = (name, fn) => { try { fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

test('new ticket keeps its reason and logs the block', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', blockedReason: 'waiting on keys' });
  assert.strictEqual(t.blockedReason, 'waiting on keys');
  assert.deepStrictEqual(types(t), ['created', 'blocked']);
});

test('a first save from the UI with a reason logs the block', () => {
  const { E } = make();
  const o = E.upsert('tasks', { id: 't_x', projectId: 'p', title: 'A', blockedReason: 'why' });
  assert.deepStrictEqual(types(o), ['blocked']);
});

test('reason is one line, capped at 140; blank means not blocked', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', blockedReason: 'a\n  b ' + 'x'.repeat(200) });
  assert.ok(!/\n/.test(t.blockedReason) && t.blockedReason.length === 140);
  const u = E.makeTask(p, { title: 'B', blockedReason: '   ' });
  assert.strictEqual(u.blockedReason, '');
  assert.deepStrictEqual(types(u), ['created']);
});

test('UI save that clears the reason unblocks and logs it', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A', blockedReason: 'waiting' });
  E.upsert('tasks', { ...clone(E.taskById(t.id)), blockedReason: '' });
  const s = E.taskById(t.id);
  assert.strictEqual(s.blockedReason, '');
  assert.strictEqual(s.audit[s.audit.length - 1].text, 'Unblocked (was: waiting)');
  E.upsert('tasks', clone(s));
  assert.strictEqual(E.taskById(t.id).audit.length, s.audit.length);
});

test('logBlockChange covers block, change and unblock for in-place edits', () => {
  const { E, p } = make();
  const t = E.makeTask(p, { title: 'A' });
  t.blockedReason = 'one'; E.logBlockChange(t, '', 'Foreman');
  t.blockedReason = 'two'; E.logBlockChange(t, 'one', 'Foreman');
  t.blockedReason = ''; E.logBlockChange(t, 'two', 'Foreman');
  assert.deepStrictEqual(t.audit.slice(1).map((a) => a.text), ['Blocked: one', 'Block reason changed: one -> two', 'Unblocked (was: two)']);
});

process.exit(fails ? 1 : 0);
