// BWI-24: blocked flag + required reason, audit trail, auto-pull treatment.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

module.exports = async function checkBlocked() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-blocked-'));
  const engine = new Engine({ dir, claude: { exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir } });
  const p = engine.makeProject({ name: 'Blk', key: 'BLK' });
  const t = engine.makeTask(p, { title: 'Needs thing' });
  assert.strictEqual(t.blocked, false);
  assert.strictEqual(t.blockedReason, '');

  const edit = (o) => ({ ...JSON.parse(JSON.stringify(engine.taskById(t.id))), ...o });

  // Blocking without a reason is rejected (missing, empty, whitespace).
  for (const r of [undefined, '', '   ']) {
    assert.throws(() => engine.upsert('tasks', edit({ blocked: true, blockedReason: r })), /reason/);
  }
  assert.strictEqual(engine.taskById(t.id).blocked, false, 'rejected save leaves ticket unblocked');

  // Blocking with a reason works, stays in its column, is logged, and blocks auto-pull.
  const before = engine.taskById(t.id).status;
  engine.upsert('tasks', edit({ blocked: true, blockedReason: '  waiting   on\nAPI key ' }));
  let cur = engine.taskById(t.id);
  assert.strictEqual(cur.blocked, true);
  assert.strictEqual(cur.blockedReason, 'waiting on API key', 'reason collapsed to one line');
  assert.strictEqual(cur.status, before, 'status column unchanged');
  assert.ok(cur.audit.some((a) => /Blocked: waiting on API key/.test(a.text)), 'block logged');
  assert.strictEqual(engine.isBlocked(cur), true);

  // Reason is capped at 140 chars.
  engine.upsert('tasks', edit({ blocked: true, blockedReason: 'x'.repeat(300) }));
  assert.strictEqual(engine.taskById(t.id).blockedReason.length, 140);

  // Unblocking clears the reason and logs it.
  engine.upsert('tasks', edit({ blocked: false, blockedReason: 'stale' }));
  cur = engine.taskById(t.id);
  assert.strictEqual(cur.blocked, false);
  assert.strictEqual(cur.blockedReason, '');
  assert.ok(cur.audit.some((a) => /Unblocked \(was: x+\)/.test(a.text)), 'unblock logged');
  assert.strictEqual(engine.isBlocked(cur), false);

  // Persistence round-trip.
  engine.upsert('tasks', edit({ blocked: true, blockedReason: 'persist me' }));
  engine.saveNow();
  const again = new Engine({ dir, claude: { exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir } });
  assert.strictEqual(again.taskById(t.id).blockedReason, 'persist me');
  assert.strictEqual(again.taskById(t.id).blocked, true);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK: blocked state (reason required, badge data, unblock clears + logs, auto-pull)');
};

if (require.main === module) module.exports().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e); process.exit(1); });
