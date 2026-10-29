// Offline checks for coding workers, project repositories, PRs, PM tickets
// and the foreman's staff tools. Uses real git against a temporary bare
// "origin"; a fake agent edits and commits in its worktree; a fake `gh`
// records what the app asks GitHub to do. Run by scripts/check.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Engine, workerEnv, parseTickets } = require('../src/engine');
const { Repos, redact } = require('../src/repos');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function codeChecks() {
  // Hermetic git: when this check runs inside a coding worker's sandbox, the
  // worker environment's GIT_CONFIG_* overrides (no credentials, no push URL)
  // must not apply to the test's own temporary repositories.
  for (const k of Object.keys(process.env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) delete process.env[k];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-code-'));
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  const until = async (j) => { for (let i = 0; i < 200 && (j.status === 'queued' || j.status === 'running'); i++) await wait(50); };

  // An "upstream" repo with one commit on main.
  const seed = path.join(tmp, 'seed');
  fs.mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  g(seed, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(seed, 'README.md'), '# demo\n');
  g(seed, 'add', '-A');
  g(seed, ...ident, 'commit', '-q', '-m', 'init');
  const origin = path.join(tmp, 'origin.git');
  g(tmp, 'clone', '-q', '--bare', seed, origin);

  const ghCalls = [];
  const fakeGh = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'auth') return 'ok';
    if (args[0] === 'pr' && args[1] === 'create') return `https://github.com/demo/repo/pull/${ghCalls.filter((a) => a[1] === 'create').length}\n`;
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: +args[2], baseRefName: args[2] === '99' ? 'prod' : 'dev', state: 'OPEN', url: `https://github.com/demo/repo/pull/${args[2]}`, title: 't' });
    if (args[0] === 'pr' && args[1] === 'merge') return '';
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 1, title: 'DEMO-1: x', url: 'u', baseRefName: 'dev', headRefName: 'feature/x', isDraft: false }]);
    throw new Error('unexpected gh ' + args.join(' '));
  };
  const root = path.join(tmp, 'Burrowby');
  const appDir = path.join(tmp, 'app');
  fs.mkdirSync(appDir);
  const repos = new Repos({ root, appDir, gh: fakeGh });

  const codeRuns = [];
  let foremanScript = [];
  const claude = {
    exe: () => 'claude.exe',
    modelFor: () => 'claude-sonnet-5-5',
    cwd: tmp,
    async run(opts) {
      const next = foremanScript.shift();
      return { structured: typeof next === 'function' ? next(opts) : next };
    },
    async stream(opts) {
      if (!opts.code) return { text: 'Notes.\n```json\n{"tickets":[{"title":"Add login","description":"Users can sign in.","priority":"high"},{"title":"Add logout","description":"Users can sign out.","priority":"low"}]}\n```', stopReason: 'end_turn', inTok: 10, outTok: 10 };
      codeRuns.push(opts);
      const mode = codeRuns.length; // 1: commits itself, 2: leaves changes uncommitted, 3: changes nothing
      opts.code.onStep('Read README.md');
      if (mode <= 2) {
        fs.writeFileSync(path.join(opts.cwd, 'hire.js'), `module.exports = ${mode};\n`);
        opts.code.onStep('Wrote hire.js');
      }
      if (mode === 1) {
        g(opts.cwd, 'add', '-A');
        g(opts.cwd, ...ident, 'commit', '-q', '-m', 'DEMO-1: add hire.js');
        opts.code.onStep('Ran git commit -m "DEMO-1: add hire.js"');
      }
      opts.onText('Added hire.js.');
      return { text: 'Added hire.js.', stopReason: 'end_turn', inTok: 50, outTok: 20 };
    },
  };
  const engine = new Engine({ dir: path.join(tmp, 'data'), claude, repos });
  assert.strictEqual(engine.byWorker('w_biscuit').capability, 'code', 'the coder defaults to code capability');
  assert.strictEqual(engine.byWorker('w_mochi').capability, 'text');

  // Repo setup creates prod and dev on the remote; the clone lives under the Burrowby root.
  const p = engine.makeProject({ name: 'Demo', key: 'DEMO' });
  const setup = await engine.setProjectRepo('DEMO', origin);
  assert.deepStrictEqual(setup.created_branches.sort(), ['dev', 'prod']);
  assert.strictEqual(setup.folder, path.join(root, 'projects', 'DEMO'));
  assert.ok(g(origin, 'branch', '--list', 'dev'), 'dev exists on the remote');
  engine.projectById(p.id).repo.github = true; // pretend the remote is GitHub so the PR step runs

  // A project saved from a window cannot change repo settings.
  engine.upsert('projects', { ...engine.projectById(p.id), repo: { source: 'evil', path: 'C:\\', status: 'ready' } });
  assert.strictEqual(engine.projectById(p.id).repo.path, setup.folder);

  // 1. The worker commits: branch from dev, pushed by the app, PR into dev, task -> Review.
  const t1 = engine.makeTask(engine.projectById(p.id), { title: 'Add hiring tool', desc: 'hire.js', assignee: 'w_biscuit' });
  const j1 = engine.sendTask(t1.id);
  await until(j1);
  assert.strictEqual(j1.status, 'done', j1.errorDetail);
  assert.strictEqual(j1.kind, 'code');
  assert.strictEqual(j1.branch, 'feature/DEMO-1-add-hiring-tool');
  assert.ok(codeRuns[0].cwd.startsWith(path.join(root, 'worktrees', 'DEMO')), 'the agent runs inside its worktree');
  assert.ok(codeRuns[0].code.allowedTools.includes('Bash(git commit:*)') && codeRuns[0].code.disallowedTools.includes('Bash(git push:*)'));
  assert.ok(!Object.keys(codeRuns[0].code.env).some((k) => /TOKEN|SECRET|API_KEY/i.test(k)), 'no secrets in the agent env');
  assert.strictEqual(codeRuns[0].code.env.GIT_CONFIG_VALUE_0, '', 'git credential helper disabled for agents');
  assert.match(codeRuns[0].systemPrompt, /Never push/);
  assert.match(g(origin, 'ls-remote', '--heads', origin, j1.branch), /feature\/DEMO-1-add-hiring-tool/, 'the app pushed the branch');
  assert.deepStrictEqual(ghCalls.find((a) => a[1] === 'create').slice(0, 6), ['pr', 'create', '--base', 'dev', '--head', j1.branch]);
  assert.strictEqual(j1.pr.url, 'https://github.com/demo/repo/pull/1');
  assert.strictEqual(j1.diff.files[0].file, 'hire.js');
  assert.strictEqual(j1.diff.insertions, 1);
  assert.ok(j1.steps.some((x) => x.startsWith('Created worktree')) && j1.steps.some((x) => x.startsWith('Opened PR #1')));
  assert.strictEqual(engine.taskById(t1.id).status, 'review');
  assert.ok(!fs.existsSync(codeRuns[0].cwd), 'worktree removed after the push');
  assert.strictEqual(g(origin, 'rev-parse', 'dev'), g(origin, 'rev-parse', 'prod'), 'agents never touch dev');

  // 2. Uncommitted work is committed by the app; 3. no changes -> failed, no PR.
  const j2 = engine.sendTask(engine.makeTask(engine.projectById(p.id), { title: 'Second', assignee: 'w_biscuit' }).id);
  await until(j2);
  assert.strictEqual(j2.status, 'done');
  assert.ok(j2.steps.some((x) => /leftover/.test(x)));
  const j3 = engine.sendTask(engine.makeTask(engine.projectById(p.id), { title: 'Third', assignee: 'w_biscuit' }).id);
  await until(j3);
  assert.strictEqual(j3.status, 'failed');
  assert.strictEqual(j3.error, 'no_changes');

  // A text worker on the same project still writes text.
  const jt = engine.createJob('Explain the repo', 'w_mochi', 'default', { projectId: p.id });
  await until(jt);
  assert.strictEqual(jt.kind, 'text');

  // Merge only into dev; release fast-forwards prod to dev.
  assert.strictEqual((await engine.mergePr('DEMO', 1)).merged, true);
  await assert.rejects(engine.mergePr('DEMO', 99), /Only PRs into dev/);
  g(origin, 'branch', '-f', 'dev', j1.branch); // stand-in for GitHub merging the PR
  const rel = await engine.releaseToProd('DEMO');
  assert.ok(rel.released && rel.commits === 1);
  assert.strictEqual(g(origin, 'rev-parse', 'prod'), g(origin, 'rev-parse', 'dev'));

  // Safety: no worktrees overlapping the folder the app runs from, or outside the Burrowby root.
  const unsafe = new Repos({ root, appDir: path.join(root, 'worktrees'), gh: fakeGh });
  await assert.rejects(unsafe.createWorktree('DEMO', 9, 'x'), /overlaps the folder this app runs from/);
  assert.throws(() => repos.assertSafe(path.join(tmp, 'elsewhere')), /outside/);
  process.env.SOME_API_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  assert.ok(!('SOME_API_TOKEN' in workerEnv()));
  delete process.env.SOME_API_TOKEN;
  assert.strictEqual(redact('https://x:ghp_abcdefghijklmnopqrstuvwxyz1234@github.com/a/b'), 'https://github.com/a/b');

  // PM worker: proposed tickets, accepted onto the Backlog.
  assert.strictEqual(parseTickets('no json').length, 0);
  engine.saveWorker({ ...engine.byWorker('w_juniper'), capability: 'pm' });
  const jp = engine.createJob('Plan the next sprint', 'w_juniper', 'default', { projectId: p.id });
  await until(jp);
  assert.strictEqual(jp.kind, 'pm');
  assert.strictEqual(jp.proposals.length, 2);
  assert.deepStrictEqual(engine.acceptProposals(jp.id, [0]), ['DEMO-4']);
  assert.strictEqual(engine.findTask('DEMO-4').status, 'backlog');

  // Foreman staff tools: hire, update, jobs at once, list PRs; then stop all.
  foremanScript = [
    { reply: '', actions: [
      { tool: 'hire_worker', input: { name: 'Sprout', species: 'frog', specialty: 'Second coder.', capability: 'code' } },
      { tool: 'update_worker', input: { worker: 'Mochi', capability: 'pm', specialty: 'PM. Turns goals into tickets.' } },
      { tool: 'set_jobs_at_once', input: { n: 3 } },
      { tool: 'list_prs', input: { project: 'DEMO' } },
    ] },
    (opts) => { assert.match(opts.prompt, /DEMO-1: x/); return { reply: 'Sprout is hired as a coder and Mochi is now our PM.', actions: [] }; },
  ];
  const fr = await engine.askForeman('Hire a second coder named Sprout and make Mochi a PM');
  assert.deepStrictEqual(fr.message.actions, ['Hired Sprout (code)', 'Updated Mochi', 'Jobs at once: 3']);
  assert.strictEqual(engine.findWorker('Sprout').capability, 'code');
  assert.strictEqual(engine.findWorker('Mochi').capability, 'pm');
  assert.strictEqual(engine.concurrency, 3);
  engine.createJob('a', 'w_clover');
  engine.createJob('b', 'w_clover');
  assert.ok(engine.stopAll() >= 2);
  await wait(100);

  // --- auto-send: Todo tasks become jobs on their own (BWI-14)
  {
    const release = [];
    let running = 0, peakRunning = 0;
    const slow = {
      exe: () => 'claude.exe', modelFor: () => 'm', cwd: tmp,
      stream: () => new Promise((resolve) => { running++; peakRunning = Math.max(peakRunning, running); release.push(() => { running--; resolve({ text: 'done', stopReason: 'end_turn' }); }); }),
    };
    const e2 = new Engine({ dir: path.join(tmp, 'auto'), claude: slow, repos: {} });
    assert.strictEqual(e2.autoSend, false, 'auto-send is off by default');
    e2.setConcurrency(1);
    e2.setFactory({ workers: e2.workers.map((w) => ({ ...w, capability: 'text' })) }); // plain jobs: no real worktrees needed
    const ap = e2.makeProject({ name: 'Auto', key: 'AUTO' });
    ap.repo = { source: 's', path: tmp, url: '', github: false, status: 'ready', error: '' }; // pretend the repo is set up
    const mk = (title, status = 'todo', extra = {}) => e2.makeTask(e2.projectById(ap.id), { title, status, ...extra });
    const jobsFor = (t) => e2.jobs.filter((x) => x.taskId === t.id).length;

    const off = mk('Off by default');
    assert.strictEqual(jobsFor(off), 0, 'off: nothing is sent');
    assert.strictEqual(e2.taskById(off.id).status, 'todo');

    e2.setFactory({ autoSend: true });
    assert.strictEqual(e2.autoSend, true);
    const bl = mk('Starts in backlog', 'backlog');
    assert.strictEqual(jobsFor(bl), 0);
    e2.upsert('tasks', { ...bl, status: 'todo' }); // moved to Todo
    assert.strictEqual(jobsFor(bl), 1, 'moving to Todo creates exactly one job');
    assert.strictEqual(e2.taskById(bl.id).status, 'progress');
    // duplicates: edit, move away and back, send again by hand-style re-save
    e2.upsert('tasks', { ...e2.taskById(bl.id), title: 'Edited' });
    e2.upsert('tasks', { ...e2.taskById(bl.id), status: 'backlog' });
    e2.upsert('tasks', { ...e2.taskById(bl.id), status: 'todo' });
    assert.strictEqual(jobsFor(bl), 1, 'no duplicate job after edits or moving again');

    // created straight into Todo; queue limit of 1 holds the rest back, none dropped
    const q1 = mk('Queue one', 'todo', { assignee: 'w_biscuit' });
    const q2 = mk('Queue two');
    assert.strictEqual(jobsFor(q1) + jobsFor(q2), 2, 'created in Todo is sent');
    await wait(50);
    assert.strictEqual(peakRunning, 1, 'jobs-at-once limit respected');
    assert.strictEqual(e2.jobs.filter((x) => x.status === 'queued').length, 2, 'extra tasks wait in the queue');
    assert.strictEqual(e2.jobs.find((x) => x.taskId === q1.id).pref, 'w_biscuit', 'assignee is used');
    for (let i = 0; i < 20 && release.length < 3; i++) { release.splice(0).forEach((f) => f()); await wait(50); }
    release.splice(0).forEach((f) => f());
    await wait(50);
    assert.ok(e2.jobs.filter((x) => x.taskId).every((x) => x.status === 'done'), 'queued jobs all ran eventually');
    assert.strictEqual(peakRunning, 1);

    // per-project override beats the global setting
    e2.setProjectAutoSend('AUTO', false);
    assert.strictEqual(jobsFor(mk('Project says off')), 0);
    e2.setFactory({ autoSend: false });
    e2.setProjectAutoSend('AUTO', true);
    assert.strictEqual(jobsFor(mk('Project says on')), 1);
    e2.setProjectAutoSend('AUTO', null);
    assert.strictEqual(jobsFor(mk('Back to global off')), 0);
    // no repo set up: never auto-sent
    e2.setFactory({ autoSend: true });
    const np = e2.makeProject({ name: 'NoRepo', key: 'NOR' });
    assert.strictEqual(jobsFor(e2.makeTask(e2.projectById(np.id), { title: 'x' })), 0, 'no repo, no auto-send');
    release.splice(0).forEach((f) => f());
    await wait(50);
    e2.saveNow();
  }

  engine.saveNow();
  console.log('OK: repo setup (prod/dev), coding job in a worktree -> app push -> PR into dev -> Review, app commits leftovers, no-change jobs fail, merge only into dev, release to prod, safety rails, PM tickets, foreman hire/update/list PRs, stop all');
  fs.rmSync(tmp, { recursive: true, force: true });
};
