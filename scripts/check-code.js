// Offline checks for coding workers, project repositories, PRs, PM tickets
// and the foreman's staff tools. Uses real git against a temporary bare
// "origin"; a fake agent edits and commits in its worktree; a fake `gh`
// records what the app asks GitHub to do. Run by scripts/check.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Engine, COLS, workerEnv, parseTickets, parseQa } = require('../src/engine');
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
  const ghConflicts = new Set(); // PR numbers GitHub should report as CONFLICTING
  const fakeGh = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'auth') return 'ok';
    if (args[0] === 'pr' && args[1] === 'create') {
      const n = ghCalls.filter((a) => a[1] === 'create').length;
      if (/ghconflict/.test(args[args.indexOf('--title') + 1])) ghConflicts.add(n);
      return `https://github.com/demo/repo/pull/${n}\n`;
    }
    if (args[0] === 'pr' && args[1] === 'view' && /mergeable/.test(args[4])) return JSON.stringify({ mergeable: ghConflicts.has(+args[2]) ? 'CONFLICTING' : 'MERGEABLE', mergeStateStatus: ghConflicts.has(+args[2]) ? 'DIRTY' : 'CLEAN', baseRefName: 'dev', state: 'OPEN' });
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
  const qaRuns = [];
  let qaScript = []; // next QA outcomes: 'pass' (default), 'fail', 'none' (no verdict)
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
      if (/QA worker/.test(opts.systemPrompt)) {
        const outcome = qaScript.shift() || 'pass';
        qaRuns.push({ ...opts, sawHire: fs.existsSync(path.join(opts.cwd, 'hire.js')), outcome });
        opts.code.onStep('Ran npm test');
        let text;
        if (outcome === 'pass') {
          fs.writeFileSync(path.join(opts.cwd, 'hire.test.js'), "require('./hire');\n");
          g(opts.cwd, 'add', '-A');
          g(opts.cwd, ...ident, 'commit', '-q', '-m', 'DEMO-1: add hire test');
          text = 'Ran the tests and added hire.test.js. Every criterion is met.\nVERDICT: PASS';
        } else if (outcome === 'fail') {
          fs.writeFileSync(path.join(opts.cwd, 'scratch.test.js'), 'x\n'); // uncommitted; must not reach the branch
          text = 'hire.js ignores the role argument (criterion 2).\nVERDICT: FAIL';
        } else text = 'I could not tell whether this works.';
        opts.onText(text);
        return { text, stopReason: 'end_turn', inTok: 30, outTok: 15 };
      }
      if (opts.cwd.includes(`${path.sep}AUTO${path.sep}`)) return autoAgent(opts);
      codeRuns.push(opts);
      const mode = codeRuns.length; // 1: commits itself, 2: leaves changes uncommitted, 3-4: changes nothing, 5+: leaves changes
      opts.code.onStep('Read README.md');
      if (mode <= 2 || mode >= 5) {
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
  // Fake coding agent for project AUTO; the task title says what it does.
  let autoOrigin = null;
  async function autoAgent(opts) {
    const title = (opts.prompt.match(/^Task AUTO[^\n]*\n\n(.*)/) || [])[1] || 'untitled change'; // "AUTO-3" or "AUTO job #12"
    const file = (name, text) => fs.writeFileSync(path.join(opts.cwd, name), text);
    if (/^fail/.test(title)) file('fail.txt', 'oops\n');
    else if (/^race/.test(title)) {
      file('shared.txt', 'mine\n');
      // Meanwhile someone lands a conflicting change on dev.
      const other = path.join(tmp, `other-${Date.now()}`);
      g(tmp, 'clone', '-q', '-b', 'dev', autoOrigin, other);
      fs.writeFileSync(path.join(other, 'shared.txt'), 'theirs\n');
      g(other, ...ident, 'commit', '-q', '-am', 'conflicting change on dev');
      g(other, 'push', '-q', 'origin', 'dev');
    } else file(`feature-${Date.now()}.txt`, `${title}\n`);
    g(opts.cwd, 'add', '-A');
    g(opts.cwd, ...ident, 'commit', '-q', '-m', `${title}`);
    opts.onText('Done.');
    return { text: 'Done.', stopReason: 'end_turn', inTok: 5, outTok: 5 };
  }
  const notices = [];
  const engine = new Engine({ dir: path.join(tmp, 'data'), claude, repos });
  engine.maxRetries = 0; // these scenarios script exact job sequences; auto-retry is covered in check.js
  engine.on('notice', (n) => notices.push(n));
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
  assert.ok(!fs.existsSync(codeRuns[0].cwd), 'worktree removed after the push');
  assert.strictEqual(g(origin, 'rev-parse', 'dev'), g(origin, 'rev-parse', 'prod'), 'agents never touch dev');

  // QA stage, pass path: the PR moves the task to Testing, QA starts by itself, a pass moves it to Review with notes.
  assert.strictEqual(engine.taskById(t1.id).status, 'testing', 'a coder PR puts the task in Testing');
  const q1 = engine.jobs.find((x) => x.qaFor === j1.id);
  assert.ok(q1 && engine.taskById(t1.id).jobs.includes(q1.id), 'QA job queued automatically for the task');
  await until(q1);
  assert.strictEqual(q1.status, 'done', q1.errorDetail);
  assert.strictEqual(q1.kind, 'qa');
  assert.strictEqual(engine.byWorker(q1.workerId).capability, 'qa', 'a QA worker is hired when the factory has none');
  assert.ok(qaRuns[0].sawHire && /qa-DEMO-1/.test(qaRuns[0].cwd), 'QA works in a checkout of the PR branch');
  assert.match(qaRuns[0].systemPrompt, /Never push/);
  assert.match(qaRuns[0].prompt, /VERDICT: PASS/);
  assert.strictEqual(engine.taskById(t1.id).status, 'review', 'QA pass moves the task to Review');
  const n1 = engine.taskById(t1.id).qa[0];
  assert.strictEqual(n1.verdict, 'pass');
  assert.match(n1.notes, /Every criterion is met/);
  assert.ok(!/VERDICT/.test(n1.notes), 'the verdict line is not part of the notes');
  assert.match(g(origin, 'ls-tree', '-r', '--name-only', j1.branch), /hire\.test\.js/, 'tests QA added join the PR on a pass');
  assert.ok(!fs.existsSync(qaRuns[0].cwd), 'QA worktree removed');

  // QA fail path: the task goes back to In progress for the original coder, notes attached, nothing pushed.
  qaScript = ['fail'];
  const t2 = engine.makeTask(engine.projectById(p.id), { title: 'Second', desc: 'Must honor the role argument.', assignee: 'w_biscuit' });
  const j2 = engine.sendTask(t2.id);
  await until(j2);
  assert.strictEqual(j2.status, 'done');
  assert.ok(j2.steps.some((x) => /leftover/.test(x)), 'uncommitted work is committed by the app');
  assert.strictEqual(engine.taskById(t2.id).status, 'testing');
  const q2 = engine.jobs.find((x) => x.qaFor === j2.id);
  await until(q2);
  assert.strictEqual(engine.taskById(t2.id).status, 'progress', 'QA fail sends the task back to In progress');
  assert.strictEqual(engine.taskById(t2.id).assignee, 'w_biscuit', 'back to the original coder');
  const n2 = engine.taskById(t2.id).qa[0];
  assert.strictEqual(n2.verdict, 'fail');
  assert.strictEqual(n2.coder, 'Biscuit');
  assert.match(n2.notes, /ignores the role argument/);
  assert.ok(!/scratch\.test\.js/.test(g(origin, 'ls-tree', '-r', '--name-only', j2.branch)), 'a failed QA pushes nothing');

  // 3. No changes -> failed, no PR, no QA. Re-sending a failed task hands the coder the QA notes.
  const j3 = engine.sendTask(engine.makeTask(engine.projectById(p.id), { title: 'Third', assignee: 'w_biscuit' }).id);
  await until(j3);
  assert.strictEqual(j3.status, 'failed');
  assert.strictEqual(j3.error, 'no_changes');
  assert.ok(!engine.jobs.some((x) => x.qaFor === j3.id), 'no QA without a PR branch');
  const j2b = engine.sendTask(t2.id);
  assert.match(j2b.text, /QA failed the previous attempt[\s\S]*ignores the role argument/);
  await until(j2b);

  // QA that cannot reach a verdict never strands a task in Testing: it goes to Review flagged for a person.
  qaScript = ['none'];
  const t4 = engine.makeTask(engine.projectById(p.id), { title: 'Fourth', assignee: 'w_biscuit' });
  const j4 = engine.sendTask(t4.id);
  await until(j4);
  await until(engine.jobs.find((x) => x.qaFor === j4.id));
  assert.strictEqual(engine.taskById(t4.id).status, 'review');
  assert.strictEqual(engine.taskById(t4.id).qa[0].verdict, 'error');
  assert.match(engine.taskById(t4.id).qa[0].notes, /QA could not finish/);

  // A direct job tied to a task goes through QA too.
  const t5 = engine.makeTask(engine.projectById(p.id), { title: 'Fifth' });
  const j5 = engine.createJob('Fifth change', 'w_biscuit', 'default', { projectId: p.id, taskId: t5.id });
  await until(j5);
  assert.strictEqual(j5.status, 'done', j5.errorDetail);
  assert.strictEqual(engine.taskById(t5.id).status, 'testing');
  await until(engine.jobs.find((x) => x.qaFor === j5.id));
  assert.strictEqual(engine.taskById(t5.id).status, 'review');

  // The column order and verdict parsing.
  assert.deepStrictEqual(COLS.map((c) => c[0]), ['backlog', 'todo', 'progress', 'testing', 'review', 'blocked', 'done'], 'Testing sits between In progress and Review; Blocked before Done');
  assert.deepStrictEqual(parseQa('Looks fine.\nVERDICT: PASS'), { verdict: 'pass', notes: 'Looks fine.' });
  assert.strictEqual(parseQa('Broke.\nverdict: fail - see above').verdict, 'fail');
  assert.strictEqual(parseQa('no verdict here').verdict, null);

  // A text worker on the same project still writes text.
  const jt = engine.createJob('Explain the repo', 'w_mochi', 'default', { projectId: p.id });
  await until(jt);
  assert.strictEqual(jt.kind, 'text');

  // Merge only into dev; release fast-forwards prod to dev.
  assert.strictEqual((await engine.mergePr('DEMO', 1)).merged, true);
  await assert.rejects(engine.mergePr('DEMO', 99), /Only PRs into dev/);
  // Release to prod, in the situation the owner hit: two PRs merged into dev on
  // GitHub (merge commits) after the app's clone last fetched, so its local
  // origin/* refs are stale. The preview must fetch and see both.
  const gh2 = path.join(tmp, 'github-side');
  g(tmp, 'clone', '-q', origin, gh2);
  g(gh2, 'checkout', '-q', '-b', 'pr2', 'origin/dev');
  fs.writeFileSync(path.join(gh2, 'docs.md'), 'docs\n');
  g(gh2, 'add', '-A');
  g(gh2, ...ident, 'commit', '-q', '-m', 'DEMO-2: docs');
  g(gh2, 'checkout', '-q', 'dev');
  g(gh2, ...ident, 'merge', '--no-ff', '-q', '-m', `Merge pull request #1 from demo/${j1.branch}`, `origin/${j1.branch}`);
  g(gh2, ...ident, 'merge', '--no-ff', '-q', '-m', 'Merge pull request #2 from demo/pr2', 'pr2');
  g(gh2, 'push', '-q', 'origin', 'dev');
  const clone = setup.folder;
  assert.strictEqual(g(clone, 'rev-parse', 'origin/dev'), g(clone, 'rev-parse', 'origin/prod'), 'the clone is stale: it still thinks dev == prod');
  const pv = await engine.releasePreview('DEMO');
  assert.strictEqual(pv.ahead, 5, "two merge commits, PR #1's coder and QA-test commits, and PR #2's commit");
  assert.deepStrictEqual(pv.prs.sort(), [1, 2]);
  assert.strictEqual(pv.diverged, false);
  assert.match(pv.summary, /5 commits on dev not yet in prod \(PRs #\d, #\d\)/);
  const rel = await engine.releaseToProd('DEMO', pv.devSha);
  assert.ok(rel.released && rel.commits === 5, JSON.stringify(rel));
  assert.strictEqual(g(origin, 'rev-parse', 'prod'), g(origin, 'rev-parse', 'dev'), 'prod fast-forwarded to dev');
  assert.strictEqual(engine.projectById(p.id).lastRelease.sha, pv.dev, 'the release is recorded on the project');
  assert.deepStrictEqual(engine.projectById(p.id).lastRelease.prs.sort(), [1, 2]);
  // A second click finds nothing to ship and says so plainly.
  const again = await engine.releaseToProd('DEMO');
  assert.strictEqual(again.released, false);
  assert.match(again.note, /^Nothing to release: prod already has everything in dev/);
  // If prod gets a commit dev doesn't have, there is no fast-forward: refuse.
  g(gh2, 'fetch', '-q');
  g(gh2, 'checkout', '-q', '-B', 'prod', 'origin/prod');
  g(gh2, ...ident, 'commit', '-q', '--allow-empty', '-m', 'hotfix on prod');
  g(gh2, 'push', '-q', 'origin', 'prod');
  const div = await engine.releasePreview('DEMO');
  assert.ok(div.diverged && div.behind === 1);
  await assert.rejects(engine.releaseToProd('DEMO'), /isn't possible. Merge prod into dev first/);
  g(gh2, 'push', '-q', '-f', 'origin', `${pv.devSha}:refs/heads/prod`); // undo the hotfix for the checks below

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
  assert.deepStrictEqual(engine.acceptProposals(jp.id, [0]), ['DEMO-6']);
  assert.strictEqual(engine.findTask('DEMO-6').status, 'backlog');

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

  // ---------- auto-merge (project AUTO, with a real `npm run check`) ----------
  // check.js fails when fail.txt exists; package.json's "check" script makes the
  // app auto-detect `npm run check`, which runs with the scrubbed worker env.
  const autoSeed = path.join(tmp, 'auto-seed');
  fs.mkdirSync(autoSeed);
  g(autoSeed, 'init', '-q', '-b', 'main');
  g(autoSeed, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(autoSeed, 'package.json'), JSON.stringify({ name: 'auto', private: true, scripts: { check: 'node check.js' } }, null, 2));
  fs.writeFileSync(path.join(autoSeed, 'check.js'), "const fs = require('fs');\nif (fs.existsSync('fail.txt')) { console.error('1 test failed: fail.txt is present'); process.exit(1); }\nconsole.log('all checks passed');\n");
  fs.writeFileSync(path.join(autoSeed, 'shared.txt'), 'base\n');
  g(autoSeed, 'add', '-A');
  g(autoSeed, ...ident, 'commit', '-q', '-m', 'init');
  autoOrigin = path.join(tmp, 'auto.git');
  g(tmp, 'clone', '-q', '--bare', autoSeed, autoOrigin);
  const pa = engine.makeProject({ name: 'Auto', key: 'AUTO' });
  await engine.setProjectRepo('AUTO', autoOrigin);
  engine.projectById(pa.id).repo.github = true;
  assert.strictEqual(engine.projectById(pa.id).autoMerge, true, 'auto-merge defaults to on');
  // One pipeline: coder PR -> Testing (QA) -> on PASS, QA's tests are pushed and the auto-merge step
  // runs in QA's worktree -> Done, or Review with the reason. On FAIL -> In progress with the coder.
  const runTask = async (title) => {
    const t = engine.makeTask(engine.projectById(pa.id), { title, assignee: 'w_biscuit' });
    const j = engine.sendTask(t.id);
    await until(j);
    assert.strictEqual(j.status, 'done', j.errorDetail);
    assert.strictEqual(engine.taskById(t.id).status, 'testing', 'the coder PR goes to Testing first');
    assert.ok(!j.merge, 'the coder job does not merge: QA comes first');
    assert.ok(j.steps.some((x) => /^Handing over to QA/.test(x)));
    const q = engine.jobs.find((x) => x.qaFor === j.id);
    await until(q);
    return { t: engine.taskById(t.id), j, q };
  };
  const mergeCalls = () => ghCalls.filter((a) => a[1] === 'merge').map((a) => a.join(' '));

  // QA passes and checks pass -> QA's tests join the PR, the app merges it into dev, task Done.
  const before = mergeCalls().length;
  const ok = await runTask('pass: add a feature');
  assert.strictEqual(ok.q.qa.verdict, 'pass');
  assert.strictEqual(ok.q.merge.status, 'merged', JSON.stringify(ok.q.merge));
  assert.strictEqual(ok.q.merge.check.cmd, 'npm run check');
  assert.ok(ok.q.merge.check.ok && /all checks passed/.test(ok.q.merge.check.output));
  assert.ok(ok.q.pr.merged && ok.j.pr.merged, 'both the QA job and the coder job show the PR as merged');
  assert.strictEqual(ok.t.status, 'done');
  assert.strictEqual(ok.t.qa[0].verdict, 'pass', 'QA notes are kept on the task');
  assert.match(g(autoOrigin, 'ls-tree', '-r', '--name-only', ok.j.branch), /hire\.test\.js/, "QA's tests were pushed before the merge");
  assert.deepStrictEqual(mergeCalls().slice(before), [`pr merge ${ok.j.pr.number} --merge --delete-branch`]);
  assert.ok(ok.q.steps.some((s) => /^Checks passed: npm run check/.test(s)) && ok.q.steps.some((s) => /^Merged PR #\d+ into dev/.test(s)));
  assert.ok(!fs.existsSync(path.join(root, 'worktrees', 'AUTO', `qa-${ok.j.branch.replace('feature/', '')}`)), 'QA worktree removed');
  assert.ok(notices.some((n) => /checks passed and PR #\d+ is merged into dev/.test(n.text)));
  assert.strictEqual(g(autoOrigin, 'rev-parse', 'prod'), g(autoSeed, 'rev-parse', 'main'), 'prod never changes on its own');

  // QA fails -> back to In progress with the coder; no checks, no merge.
  qaScript = ['fail'];
  const qf = await runTask('pass: but QA rejects it');
  assert.strictEqual(qf.t.status, 'progress');
  assert.strictEqual(qf.t.assignee, 'w_biscuit');
  assert.ok(!qf.q.merge, 'no auto-merge after a QA fail');
  assert.strictEqual(mergeCalls().length, before + 1);

  // QA passes but the checks fail -> PR left open, task in Review, reason and output recorded, owner told.
  const bad = await runTask('fail: break the checks');
  assert.strictEqual(bad.q.qa.verdict, 'pass');
  assert.strictEqual(bad.q.merge.status, 'blocked');
  assert.match(bad.q.merge.reason, /^checks failed \(npm run check, exit \d+\)/);
  assert.match(bad.q.merge.check.output, /fail\.txt is present/);
  assert.ok(!bad.q.pr.merged);
  assert.strictEqual(bad.t.status, 'review');
  assert.strictEqual(mergeCalls().length, before + 1, 'no merge attempted');
  assert.ok(notices.some((n) => /needs you: checks failed/.test(n.text)), 'the owner is told');

  // dev moves on with a conflicting change while the coder runs -> caught in QA's worktree, PR left open.
  const race = await runTask('race: edit shared.txt');
  assert.strictEqual(race.q.merge.status, 'blocked');
  assert.match(race.q.merge.reason, /^conflicts with dev in shared\.txt/);
  assert.strictEqual(race.t.status, 'review');

  // GitHub says the PR is not mergeable -> left open.
  const ghc = await runTask('ghconflict: another feature');
  assert.strictEqual(ghc.q.merge.status, 'blocked');
  assert.match(ghc.q.merge.reason, /GitHub reports a conflict/);
  assert.strictEqual(ghc.t.status, 'review');

  // Auto-merge off -> QA still runs; on pass the task goes to Review, no checks, no merge.
  engine.upsert('projects', { ...engine.projectById(pa.id), autoMerge: false });
  assert.strictEqual(engine.projectById(pa.id).autoMerge, false);
  const off = await runTask('pass: with auto-merge off');
  assert.strictEqual(off.q.qa.verdict, 'pass');
  assert.strictEqual(off.q.merge, undefined);
  assert.strictEqual(off.t.status, 'review');
  assert.strictEqual(mergeCalls().length, before + 1);

  // A coding job not tied to a task skips QA and auto-merges directly (as before QA existed).
  engine.upsert('projects', { ...engine.projectById(pa.id), autoMerge: true });
  const direct = engine.createJob('pass: direct job', 'w_biscuit', 'default', { projectId: pa.id });
  await until(direct);
  assert.strictEqual(direct.merge.status, 'merged', JSON.stringify(direct.merge));
  assert.ok(!engine.jobs.some((x) => x.qaFor === direct.id), 'no QA without a task');

  engine.saveNow();
  console.log('OK: repo setup (prod/dev), coding job in a worktree -> app push -> PR into dev -> Review, app commits leftovers, no-change jobs fail, merge only into dev, release preview + fast-forward (stale refs, repeat click, diverged), QA + auto-merge pipeline (QA pass + checks pass -> merged + Done; QA fail -> In progress; failing checks, dev conflict, GitHub conflict, setting off -> Review; no task -> direct auto-merge), safety rails, PM tickets, foreman hire/update/list PRs, stop all');
  fs.rmSync(tmp, { recursive: true, force: true });
};
