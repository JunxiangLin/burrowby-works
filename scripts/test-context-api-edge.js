// BWI-48 (QA): malformed worker blocks don't fail the job; secrets are redacted; task-scope blocks attach to the task.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');
const api = require('../src/context-api');

const reply = { text: '' };
const fakeClaude = (dir) => ({
  exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir,
  stream: async () => ({ text: reply.text, stopReason: 'end_turn', inTok: 1, outTok: 1 }),
  run: async () => ({ structured: {} }),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-ctxedge-'));
  const E = new Engine({ dir, claude: fakeClaude(dir) });
  E.autoSummary = false;
  const p = E.makeProject({ name: 'Zoo', key: 'ZOO' });
  const t = E.makeTask(p, { title: 'Write guide', desc: 'x' });

  const secret = 'ghp_' + 'a'.repeat(30);
  const m = api.createContext(E, { title: 'Key', content: `token ${secret}`, project: 'ZOO' });
  assert.ok(!api.readContext(E, { id: m.id }).content.includes(secret), 'secret redacted');

  reply.text = 'Result.\n```context-entry\n{not json}\n```';
  const j1 = E.sendTask(t.id);
  await wait(150);
  assert.strictEqual(j1.status, 'done', 'malformed block does not fail job');
  assert.match(j1.errorDetail || '', /Context entry not saved/);

  reply.text = 'Result.\n```context-entry\n{"title":"TaskOnly","content":"scoped","scope":"task"}\n```';
  const j2 = E.sendTask(t.id);
  await wait(150);
  assert.strictEqual(j2.contextCreated.length, 1);
  assert.ok(E.taskById(t.id).ctx.includes(j2.contextCreated[0]));
  assert.ok(!E.projectById(p.id).ctx.includes(j2.contextCreated[0]));
  console.log('OK: context API edge cases');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
