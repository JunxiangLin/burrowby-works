// BW-6: job-finished event (pet, title, status) and the notifyJobs setting.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');
const { Store } = require('../src/store');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function checkNotify() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-notify-'));
  let fail = false, hold = false;
  const claude = {
    exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir,
    stream: async (o) => {
      if (fail) throw Object.assign(new Error('boom'), { code: 'error', text: '' });
      o.onText('ok');
      if (hold) await new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('Stopped.'), { code: 'cancelled', aborted: true, text: '' }))));
      return { text: 'ok', stopReason: 'end_turn', inTok: 1, outTok: 1, model: 'm' };
    },
    run: async () => ({ structured: {} }),
  };
  const engine = new Engine({ dir, claude });
  const events = [];
  engine.on('job-finished', (e) => events.push(e));

  const ok = engine.createJob('Write the docs\nsecond line', 'any');
  await wait(150);
  assert.strictEqual(ok.status, 'done');
  assert.strictEqual(events.length, 1, 'one event for a done job');
  assert.strictEqual(events[0].status, 'done');
  assert.strictEqual(events[0].title, 'Write the docs', 'first line of job text when no task');
  assert.ok(events[0].pet && events[0].pet !== 'A worker', 'pet name present');

  fail = true;
  const bad = engine.createJob('Broken job', 'any');
  await wait(150);
  assert.strictEqual(bad.status, 'failed');
  assert.strictEqual(events.length, 2, 'one event for a failed job');
  assert.strictEqual(events[1].status, 'failed');
  assert.strictEqual(events[1].title, 'Broken job');

  fail = false; hold = true;
  const stopped = engine.createJob('Stop me', 'any');
  await wait(50);
  engine.stopJob(stopped.id);
  await wait(100);
  assert.strictEqual(stopped.status, 'cancelled');
  assert.strictEqual(events.length, 2, 'cancelled job sends no event');

  // Setting: defaults on, persists across a restart.
  const sdir = path.join(dir, 'store');
  assert.strictEqual(new Store(sdir).getConfig().notifyJobs, true, 'defaults to on');
  new Store(sdir).saveConfig({ notifyJobs: false });
  assert.strictEqual(new Store(sdir).getConfig().notifyJobs, false, 'off persists');
  new Store(sdir).saveConfig({ notifyJobs: true });
  assert.strictEqual(new Store(sdir).getConfig().notifyJobs, true, 'on persists');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK: job-finished event (done/failed, no cancel) + notifyJobs default/persist');
};

if (require.main === module) module.exports().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e); process.exit(1); });
