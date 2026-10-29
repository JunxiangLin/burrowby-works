// BW-3 tests: `node scripts/test-worktree-lock.js`. createWorktree is serialized per repo, parallel across repos.
const assert = require('assert');
const { Repos } = require('../src/repos.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function make(log, failKey) {
  const R = Object.create(Repos.prototype);
  let active = {}, maxActive = {};
  R._createWorktree = async (key, n) => {
    active[key] = (active[key] || 0) + 1;
    maxActive[key] = Math.max(maxActive[key] || 0, active[key]);
    log.push('start ' + key + n);
    await sleep(20);
    log.push('end ' + key + n);
    active[key]--;
    if (failKey === key + n) throw new Error('boom');
    return key + n;
  };
  return { R, maxActive };
}
let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

(async () => {
  await test('same repo: one at a time, in order', async () => {
    const log = []; const { R, maxActive } = make(log);
    const res = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => R.createWorktree('BW', n, 't')));
    assert.deepStrictEqual(res, [1, 2, 3, 4, 5, 6, 7].map((n) => 'BW' + n));
    assert.strictEqual(maxActive.BW, 1);
    assert.strictEqual(log[0], 'start BW1');
    assert.strictEqual(log[1], 'end BW1');
  });
  await test('different repos run in parallel', async () => {
    const log = []; const { R } = make(log);
    await Promise.all([R.createWorktree('A', 1, 't'), R.createWorktree('B', 1, 't')]);
    assert.deepStrictEqual(log.slice(0, 2), ['start A1', 'start B1']);
  });
  await test('a failure does not block later calls and is reported to its caller', async () => {
    const log = []; const { R } = make(log, 'BW1');
    const p1 = R.createWorktree('BW', 1, 't');
    const p2 = R.createWorktree('BW', 2, 't');
    await assert.rejects(p1, /boom/);
    assert.strictEqual(await p2, 'BW2');
  });
  await test('lock map is cleaned up when idle', async () => {
    const log = []; const { R } = make(log);
    await R.createWorktree('BW', 1, 't');
    await sleep(5);
    assert.strictEqual(R._wtLocks.size, 0);
  });
  if (fails) { console.log(fails + ' failed'); process.exit(1); }
  console.log('OK: worktree lock');
})();
