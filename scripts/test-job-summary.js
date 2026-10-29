// BWI-33: a finished job writes a summary to the context library (found by search_context); a setting turns it off.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

const fakeClaude = (dir) => ({
  exe: () => 'claude.exe',
  modelFor: () => 'm',
  cwd: dir,
  stream: async () => ({ text: 'The zebra migration plan is ready.', stopReason: 'end_turn', inTok: 10, outTok: 5 }),
  run: async () => ({ structured: {} }),
});
const make = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-summary-')); return new Engine({ dir, claude: fakeClaude(dir) }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const E = make();
  assert.strictEqual(E.autoSummary, true, 'default is on');
  assert.strictEqual(E.factoryDoc().autoSummary, true);

  const j = E.createJob('Plan the zebra migration', E.workers[0].id);
  await wait(100);
  assert.strictEqual(j.status, 'done');
  const found = E.tools().search_context({ query: 'zebra migration plan' });
  assert.strictEqual(found.length, 1, 'summary is findable with search_context');
  assert.match(found[0].title, new RegExp(`^Job #${j.n} summary`));
  assert.match(found[0].excerpt, /The zebra migration plan is ready\./);
  assert.ok(E.contexts[0].tags.includes('job-summary'));

  E.saveJobSummary(j);
  assert.strictEqual(E.contexts.length, 1, 'saving again updates, no duplicate');

  E.setFactory({ autoSummary: false });
  assert.strictEqual(E.factoryDoc().autoSummary, false);
  const j2 = E.createJob('Plan the giraffe merger', E.workers[0].id);
  await wait(100);
  assert.strictEqual(j2.status, 'done');
  assert.strictEqual(E.tools().search_context({ query: 'giraffe' }).length, 0, 'no summary when off');

  E.saveNow();
  assert.strictEqual(new Engine({ dir: E.dir, claude: E.claude }).autoSummary, false, 'setting persists');
  console.log('OK: job summary saved to context, searchable, setting on/off');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
