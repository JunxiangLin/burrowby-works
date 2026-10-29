// BWI-48: workers can search, read and create Context library entries; entries attach to a project or task and later jobs carry them.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');
const api = require('../src/context-api');

let prompts = [];
const reply = { text: 'Done.' };
const fakeClaude = (dir) => ({
  exe: () => 'claude.exe', modelFor: () => 'm', cwd: dir,
  stream: async (o) => { prompts.push(o.prompt); return { text: reply.text, stopReason: 'end_turn', inTok: 1, outTok: 1 }; },
  run: async () => ({ structured: {} }),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-ctxapi-'));
  const E = new Engine({ dir, claude: fakeClaude(dir) });
  E.autoSummary = false;
  const p = E.makeProject({ name: 'Zoo', key: 'ZOO' });
  const t = E.makeTask(p, { title: 'Write guide', desc: 'x' });

  // direct API
  const made = api.createContext(E, { title: 'Tone', content: 'Speak like a penguin.', kind: 'style', project: 'ZOO' });
  assert.strictEqual(made.attached_to, 'ZOO');
  assert.ok(E.projectById(p.id).ctx.includes(made.id), 'attached to project');
  assert.ok(E.contexts.some((c) => c.id === made.id), 'in library');
  assert.strictEqual(api.searchContext(E, { query: 'penguin' })[0].id, made.id);
  assert.strictEqual(api.searchContext(E, { query: 'penguin', project: 'ZOO' }).length, 1);
  assert.match(api.readContext(E, { id: made.id }).content, /penguin/);
  const tm = api.createContext(E, { title: 'Task note', content: 'only here', task: E.taskKey(t) });
  assert.ok(E.taskById(t.id).ctx.includes(tm.id) && !E.projectById(p.id).ctx.includes(tm.id), 'task-only attach');
  assert.throws(() => api.createContext(E, { title: 'a', content: 'b' }), /project or task/);
  assert.throws(() => api.readContext(E, { id: 'nope' }), /No context entry/);

  // worker writes an entry during a job; later job carries it
  reply.text = 'Here you go.\n```context-entry\n{"title":"Facts","content":"Zebras are striped.","kind":"data","scope":"project"}\n```';
  const j = E.sendTask(t.id);
  await wait(150);
  assert.strictEqual(j.status, 'done');
  assert.ok(!/context-entry/.test(j.output), 'block stripped from output');
  assert.strictEqual(j.contextCreated.length, 1);
  assert.ok(E.contexts.some((c) => c.title === 'Facts'), 'appears in library');
  prompts = [];
  E.sendTask(t.id);
  await wait(150);
  assert.ok(prompts.some((x) => x.includes('Zebras are striped.')), 'later job carries the entry');

  // tools() surface
  assert.strictEqual(E.tools().read_context({ id: made.id }).title, 'Tone');
  console.log('OK: context API create/search/read, project and task attach, worker blocks, later jobs carry entries');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
