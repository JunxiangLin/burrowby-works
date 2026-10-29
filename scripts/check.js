// Offline self-check of the Burrowby Works engine against a fake Claude Code
// CLI: scheduler and jobs-at-once limit, streaming + time to first token,
// stop, board tasks (send to factory -> Review), context injection, the
// foreman's action loop, import (merge/replace) and persistence.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine } = require('../src/engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-check-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let inFlight = 0, peak = 0;
const workerPrompts = [];
let foremanScript = [];
const foremanCalls = [];

const fakeClaude = {
  exe: () => 'claude.exe',
  modelFor: (tier) => ({ quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' })[tier],
  cwd: dir,
  // Worker jobs: stream a few deltas, can be aborted.
  stream(opts) {
    workerPrompts.push(opts);
    return new Promise((resolve, reject) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      let text = '';
      const parts = ['Hello', ' from', ' the', ' worker.'];
      let i = 0;
      const step = () => {
        if (i < parts.length) { text += parts[i++]; opts.onText(text); t = setTimeout(step, 15); }
        else { inFlight--; resolve({ text, stopReason: 'end_turn', inTok: 100, outTok: 7, model: opts.model }); }
      };
      let t = setTimeout(step, 30);
      opts.signal.addEventListener('abort', () => { clearTimeout(t); inFlight--; reject(Object.assign(new Error('Stopped.'), { code: 'cancelled', aborted: true, text })); });
    });
  },
  // Foreman and suggestions: scripted structured replies.
  async run(opts) {
    if (opts.jsonSchema && opts.jsonSchema.properties.tasks) return { structured: { tasks: [{ title: 'Write the FAQ', description: 'Five questions.', priority: 'high' }] } };
    foremanCalls.push(opts);
    const next = foremanScript.shift();
    return { structured: typeof next === 'function' ? next(opts) : next };
  },
};

(async () => {
  let engine = new Engine({ dir, claude: fakeClaude });
  const notices = [];
  engine.on('notice', (n) => notices.push(n));
  assert.strictEqual(engine.workers.length, 4, 'default crew');
  assert.strictEqual(engine.concurrency, 2);

  // --- jobs: limit of 2 at once, streaming, first token, stop
  const a = engine.createJob('Job A', 'any', 'quick');
  const b = engine.createJob('Job B', 'any', 'default');
  const c = engine.createJob('Job C', 'any', 'complex');
  assert.strictEqual(c.status, 'queued');
  engine.stopJob(c.id);
  assert.strictEqual(c.status, 'cancelled');
  await wait(200);
  assert.strictEqual(peak, 2, 'two jobs at once');
  assert.strictEqual(a.status, 'done');
  assert.strictEqual(a.output, 'Hello from the worker.');
  assert.ok(a.firstTokenAt >= a.startedAt && a.firstTokenAt <= a.finishedAt, 'time to first token recorded');
  assert.strictEqual(a.model, 'claude-haiku-5-5', 'quick tier -> quick model');
  assert.strictEqual(b.model, 'claude-sonnet-5-5');
  assert.strictEqual(a.outTok, 7, 'real token usage from the CLI');

  const d = engine.createJob('Job D', 'w_biscuit');
  await wait(40);
  assert.strictEqual(d.status, 'running');
  assert.strictEqual(d.workerId, 'w_biscuit', 'named worker respected');
  engine.stopJob(d.id);
  await wait(20);
  assert.strictEqual(d.status, 'cancelled');

  // --- board + context
  const p = engine.sampleProject();
  assert.strictEqual(p.key, 'BLOG');
  const blogTasks = engine.tasks.filter((t) => t.projectId === p.id);
  assert.strictEqual(blogTasks.length, 5);
  const t1 = blogTasks[0];
  const j = engine.sendTask(t1.id);
  assert.strictEqual(engine.taskById(t1.id).status, 'progress');
  assert.deepStrictEqual(j.ctx, p.ctx, 'project context goes with the task');
  await wait(200);
  assert.strictEqual(j.status, 'done');
  assert.strictEqual(engine.taskById(t1.id).status, 'review', 'task moves to Review when the job ships');
  const prompt = workerPrompts.find((x) => x.prompt.includes('Pick five launch post topics')).prompt;
  assert.match(prompt, /Reference context\. Use it where relevant and follow any style rules in it:\n\n=== Blog voice guide \(Style guide\) ===\nSample entry\./, 'contextBlock format matches the artifact');
  assert.match(prompt, /^You are \w+, a worker in a small agent factory\./, 'buildPrompt matches the artifact');
  const sugg = await engine.suggestTasks(p.id);
  assert.strictEqual(sugg[0].title, 'Write the FAQ');

  // --- foreman: assigns + reads in round 1, answers in round 2
  foremanScript = [
    { reply: '', actions: [{ tool: 'assign_job', input: { text: 'Write a haiku', worker: 'Juniper' } }, { tool: 'list_tasks', input: { project: 'BLOG' } }, { tool: 'create_task', input: { project: 'BLOG', title: 'Plan launch party' } }] },
    (opts) => {
      assert.match(opts.prompt, /TOOL RESULTS/);
      assert.match(opts.prompt, /BLOG-1/);
      return { reply: 'Juniper has the haiku as job #6.', actions: [] };
    },
  ];
  const r = await engine.askForeman('Get Juniper to write a haiku and show me the blog tasks');
  assert.strictEqual(r.message.text, 'Juniper has the haiku as job #6.');
  assert.deepStrictEqual(r.message.actions, ['Job #6 → Juniper', 'BLOG-6 created']);
  assert.strictEqual(foremanCalls.length, 2);
  assert.match(foremanCalls[0].systemPrompt, /You are Marmalade, the foreman of Burrowby Works/);
  assert.strictEqual(engine.chat.length, 2);
  assert.ok(engine.jobByN(6).byForeman);
  await wait(200);
  assert.ok(notices.some((n) => n.kind === 'job' && /Want the summary\?/.test(n.text)), 'foreman jobs get a follow-up notice');

  // --- foreman sees history on the next turn
  foremanScript = [(opts) => { assert.match(opts.prompt, /Owner: Get Juniper/); return { reply: 'All done.', actions: [{ tool: 'get_factory_status', input: {} }] }; }, { reply: 'Everyone is idle.', actions: [] }];
  assert.strictEqual((await engine.askForeman('Status?')).message.text, 'Everyone is idle.');

  // --- BWI-25: foreman cannot move a task with unchecked acceptance criteria to Done
  {
    const gp = engine.projects.find((x) => x.key === 'BLOG');
    const g = engine.makeTask(gp, { title: 'Gated', desc: 'Intro.\nAcceptance: has a title; has a body', status: 'review' });
    const key = engine.taskKey(g);
    const upd = async (input) => { foremanScript = [{ reply: '', actions: [{ tool: 'update_task', input }] }, { reply: 'ok', actions: [] }]; await engine.askForeman('move it'); };
    await upd({ task: key, status: 'done' });
    assert.strictEqual(engine.taskById(g.id).status, 'review', 'blocked with no checklist results');
    g.acceptance = { items: [{ text: 'has a title', result: 'pass' }, { text: 'has a body', result: 'fail' }], override: false };
    await upd({ task: key, status: 'done' });
    assert.strictEqual(engine.taskById(g.id).status, 'review', 'blocked while a criterion fails');
    g.acceptance.override = true;
    await upd({ task: key, status: 'done' });
    assert.strictEqual(engine.taskById(g.id).status, 'done', 'owner override allows Done');
    const g2 = engine.makeTask(gp, { title: 'Gated2', desc: 'Acceptance: one', status: 'review' });
    g2.acceptance = { items: [{ text: 'one', result: 'pass' }], override: false };
    await upd({ task: engine.taskKey(g2), status: 'done' });
    assert.strictEqual(engine.taskById(g2.id).status, 'done', 'all pass allows Done');
    const g3 = engine.makeTask(gp, { title: 'Plain', desc: 'No criteria here', status: 'review' });
    await upd({ task: engine.taskKey(g3), status: 'done' });
    assert.strictEqual(engine.taskById(g3.id).status, 'done', 'ungated tasks unaffected');
  }

  // --- retire
  assert.strictEqual(engine.retireWorker('w_clover').ok, true);
  assert.strictEqual(engine.workers.length, 3);

  // --- persistence
  engine.saveNow();
  const reloaded = new Engine({ dir, claude: fakeClaude });
  assert.strictEqual(reloaded.jobs.length, engine.jobs.length);
  assert.strictEqual(reloaded.tasks.length, 9);
  assert.strictEqual(reloaded.chat.length, 4 + 2 * 5);
  assert.strictEqual(reloaded.workers.length, 3);

  // --- import: merge renumbers clashing job numbers; replace swaps everything
  const exp = {
    format: 'burrowby-works-export', version: 1, exportedAt: Date.now(),
    factory: { workers: [{ id: 'w_new', name: 'Fig', species: 'chick', specialty: 'Poet.' }], concurrency: 3, foreman: { name: 'Bao', species: 'bear', tier: 'default' } },
    jobs: [{ id: 'j_imp1', n: 1, text: 'Imported done', status: 'done', createdAt: 1, startedAt: 2, firstTokenAt: 3, finishedAt: 4, output: 'ok', unknownField: 1 }, { id: 'j_imp2', n: 2, text: 'Imported queued', status: 'queued', createdAt: 5 }],
    projects: [{ id: 'p_imp', name: 'Imported', key: 'IMP', color: '#3E8FB0', ctx: [], seq: 1 }],
    tasks: [{ id: 't_imp', projectId: 'p_imp', n: 1, title: 'Imported task', status: 'todo' }],
    contexts: [{ id: 'c_imp', title: 'Imported note', kind: 'note', content: 'hi' }],
    chat: [{ role: 'user', text: 'hello from the artifact', t: 1 }],
  };
  const before = reloaded.jobs.length;
  reloaded.importData(exp, 'merge');
  assert.strictEqual(reloaded.jobs.length, before + 2);
  const ns = reloaded.jobs.map((x) => x.n);
  assert.strictEqual(new Set(ns).size, ns.length, 'job numbers stay unique after merge');
  assert.strictEqual(reloaded.jobById('j_imp2').status, 'cancelled', 'imported unfinished jobs never auto-run');
  assert.strictEqual(reloaded.workers.length, 4);
  assert.strictEqual(reloaded.foreman.name, 'Marmalade', 'merge keeps the local foreman');
  assert.strictEqual(reloaded.chat[0].text, 'hello from the artifact');
  reloaded.importData(exp, 'replace');
  assert.strictEqual(reloaded.jobs.length, 2);
  assert.strictEqual(reloaded.foreman.name, 'Bao');
  assert.strictEqual(reloaded.workers.length, 1);
  assert.strictEqual(reloaded.concurrency, 1, 'imported value is clamped to the crew size');
  assert.throws(() => reloaded.setConcurrency(2), /1 to 1/, 'cannot exceed hired workers');
  for (let i = 0; i < 11; i++) reloaded.hireWorker({ name: `Extra${i}` });
  assert.strictEqual(reloaded.workers.length, 12);
  reloaded.setConcurrency(12);
  assert.strictEqual(reloaded.concurrency, 12, 'accepts up to 12');
  assert.throws(() => reloaded.setConcurrency(13), /1 to 12/);
  assert.throws(() => reloaded.setConcurrency(0), /1 to 12/);
  assert.throws(() => reloaded.setConcurrency(2.5), /whole number/);
  assert.strictEqual(reloaded.concurrency, 12, 'rejected values leave the setting alone');
  assert.throws(() => Engine.validateImport({ format: 'other' }), /not a Burrowby Works export/);

  console.log(`OK: scheduler (peak ${peak}), streaming + TTFT, stop, board -> Review, context block, foreman loop (${foremanCalls.length} calls), retire, persistence, import merge/replace`);

  await require('./check-code')();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
