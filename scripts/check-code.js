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
      if (opts.cwd.includes(`${path.sep}AUTO${path.sep}`)) return autoAgent(opts);
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
  // Fake coding agent for project AUTO; the task title says what it does.
  let autoOrigin = null;
  async function autoAgent(opts) {
    const title = (opts.prompt.match(/^Task AUTO-\d+\n\n(.*)/) || [])[1] || '';
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
  assert.strictEqual(pv.ahead, 4, 'two merge commits plus the two feature commits');
  assert.deepStrictEqual(pv.prs.sort(), [1, 2]);
  assert.strictEqual(pv.diverged, false);
  assert.match(pv.summary, /4 commits on dev not yet in prod \(PRs #\d, #\d\)/);
  const rel = await engine.releaseToProd('DEMO', pv.devSha);
  assert.ok(rel.released && rel.commits === 4, JSON.stringify(rel));
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
  const runTask = async (title) => {
    const t = engine.makeTask(engine.projectById(pa.id), { title, assignee: 'w_biscuit' });
    const j = engine.sendTask(t.id);
    await until(j);
    return { t: engine.taskById(t.id), j };
  };
  const mergeCalls = () => ghCalls.filter((a) => a[1] === 'merge').map((a) => a.join(' '));

  // Checks pass -> the app merges the PR into dev (merge commit) and the task is Done.
  const before = mergeCalls().length;
  const ok = await runTask('pass: add a feature');
  assert.strictEqual(ok.j.status, 'done', ok.j.errorDetail);
  assert.strictEqual(ok.j.merge.status, 'merged', JSON.stringify(ok.j.merge));
  assert.strictEqual(ok.j.merge.check.cmd, 'npm run check');
  assert.ok(ok.j.merge.check.ok && /all checks passed/.test(ok.j.merge.check.output));
  assert.ok(ok.j.pr.merged);
  assert.strictEqual(ok.t.status, 'done');
  assert.deepStrictEqual(mergeCalls().slice(before), [`pr merge ${ok.j.pr.number} --merge --delete-branch`]);
  assert.ok(ok.j.steps.some((s) => /^Checks passed: npm run check/.test(s)) && ok.j.steps.some((s) => /^Merged PR #\d+ into dev/.test(s)));
  assert.ok(!fs.existsSync(path.join(root, 'worktrees', 'AUTO', ok.j.branch.replace('feature/', ''))), 'worktree removed');
  assert.strictEqual(g(autoOrigin, 'rev-parse', 'prod'), g(autoSeed, 'rev-parse', 'main'), 'prod never changes on its own');

  // Checks fail -> PR left open, task stays in Review, reason and output recorded.
  const bad = await runTask('fail: break the checks');
  assert.strictEqual(bad.j.status, 'done');
  assert.strictEqual(bad.j.merge.status, 'blocked');
  assert.match(bad.j.merge.reason, /^checks failed \(npm run check, exit \d+\)/);
  assert.match(bad.j.merge.check.output, /fail\.txt is present/);
  assert.ok(!bad.j.pr.merged);
  assert.strictEqual(bad.t.status, 'review');
  assert.strictEqual(mergeCalls().length, before + 1, 'no merge attempted');
  assert.ok(notices.some((n) => /needs you: checks failed/.test(n.text)), 'the owner is told');

  // dev moves on with a conflicting change while the worker runs -> caught locally, PR left open.
  const race = await runTask('race: edit shared.txt');
  assert.strictEqual(race.j.merge.status, 'blocked');
  assert.match(race.j.merge.reason, /^conflicts with dev in shared\.txt/);
  assert.strictEqual(race.t.status, 'review');

  // GitHub says the PR is not mergeable -> left open.
  const ghc = await runTask('ghconflict: another feature');
  assert.strictEqual(ghc.j.merge.status, 'blocked');
  assert.match(ghc.j.merge.reason, /GitHub reports a conflict/);

  // Auto-merge off for the project -> no checks, no merge, task in Review.
  engine.upsert('projects', { ...engine.projectById(pa.id), autoMerge: false });
  assert.strictEqual(engine.projectById(pa.id).autoMerge, false);
  const off = await runTask('pass: with auto-merge off');
  assert.strictEqual(off.j.merge, undefined);
  assert.strictEqual(off.t.status, 'review');
  assert.strictEqual(mergeCalls().length, before + 1);

  engine.saveNow();
  console.log('OK: repo setup (prod/dev), coding job in a worktree -> app push -> PR into dev -> Review, app commits leftovers, no-change jobs fail, merge only into dev, release preview + fast-forward (stale refs, repeat click, diverged), auto-merge (pass -> merged + Done; failing checks, dev conflict, GitHub conflict, setting off -> left open in Review), safety rails, PM tickets, foreman hire/update/list PRs, stop all');
  fs.rmSync(tmp, { recursive: true, force: true });
};
