// Offline checks for the self-updater (src/updater.js) with real git: a bare
// "GitHub" remote, an "app folder" clone on prod, and a second clone that plays
// the Release to prod button. Also the restart plan, the install helper and the
// engine's hold on new jobs while a restart waits. Run by scripts/check.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Updater, installScript, planRestart } = require('../src/updater');
const { Engine } = require('../src/engine');

module.exports = async function updateChecks() {
  for (const k of Object.keys(process.env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) delete process.env[k];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-update-'));
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  const write = (dir, f, text) => fs.writeFileSync(path.join(dir, f), text);
  const commit = (dir, msg) => { g(dir, 'add', '-A'); g(dir, ...ident, 'commit', '-q', '-m', msg); };

  // The repository, with prod.
  const seed = path.join(tmp, 'seed');
  fs.mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'prod');
  g(seed, 'config', 'core.autocrlf', 'false');
  write(seed, 'package.json', '{"name":"bw"}\n');
  write(seed, 'package-lock.json', '{"lockfileVersion":3}\n');
  write(seed, '.gitignore', 'node_modules/\n');
  commit(seed, 'v1');
  const origin = path.join(tmp, 'origin.git');
  g(tmp, 'clone', '-q', '--bare', seed, origin);
  // The folder the app runs from, with "node_modules/electron/dist/electron.exe".
  const appDir = path.join(tmp, 'app');
  g(tmp, '-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'prod', origin, appDir);
  g(appDir, 'config', 'core.autocrlf', 'false');
  const electron = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  fs.mkdirSync(path.dirname(electron), { recursive: true });
  write(path.dirname(electron), 'electron.exe', 'binary');
  // Where releases come from.
  const releaser = path.join(tmp, 'releaser');
  g(tmp, '-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'prod', origin, releaser);
  g(releaser, 'config', 'core.autocrlf', 'false');
  const release = (files, msg) => { for (const [f, t] of Object.entries(files)) write(releaser, f, t); commit(releaser, msg); g(releaser, 'push', '-q', 'origin', 'prod'); };

  const up = new Updater({ dir: appDir, electronPath: electron });

  // Up to date.
  let st = await up.inspect();
  assert.strictEqual(st.state, 'up-to-date', JSON.stringify(st));
  assert.strictEqual(st.behind, 0);

  // Two commits released (e.g. on GitHub): the check sees them; the update fast-forwards.
  release({ 'a.js': 'a\n' }, 'feature A');
  release({ 'b.js': 'b\n' }, 'feature B');
  st = await up.inspect();
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(st.behind, 2);
  const before = g(appDir, 'rev-parse', 'HEAD');
  st = await up.update();
  assert.strictEqual(st.state, 'ready', JSON.stringify(st));
  assert.strictEqual(st.changes, 2);
  assert.strictEqual(st.needsInstall, false, 'no lockfile change, no npm ci');
  assert.strictEqual(st.to, g(origin, 'rev-parse', '--short=7', 'prod'));
  assert.strictEqual(st.from, before.slice(0, 7));
  assert.ok(fs.existsSync(path.join(appDir, 'b.js')), 'files updated in the app folder');
  assert.ok(fs.existsSync(electron), 'the shortcut target survives');
  assert.strictEqual((await up.update()).state, 'up-to-date', 'a second update is a no-op');

  // A lockfile change is flagged for npm ci after the app exits; nothing runs npm in-process.
  release({ 'package-lock.json': '{"lockfileVersion":3,"x":1}\n' }, 'bump deps');
  st = await up.update();
  assert.strictEqual(st.state, 'ready');
  assert.strictEqual(st.needsInstall, true);

  // Electron binary gone after an update -> an error with the fix, not a silent restart into nothing.
  release({ 'c.js': 'c\n' }, 'feature C');
  const noElectron = new Updater({ dir: appDir, electronPath: path.join(tmp, 'missing', 'electron.exe') });
  st = await noElectron.update();
  assert.strictEqual(st.state, 'error');
  assert.match(st.message, /is missing\. Run "npm ci"/);

  // Dirty folder: untouched, reason + commands.
  release({ 'd.js': 'd\n' }, 'feature D');
  write(appDir, 'a.js', 'local edit\n');
  const headDirty = g(appDir, 'rev-parse', 'HEAD');
  st = await up.update();
  assert.strictEqual(st.state, 'blocked');
  assert.strictEqual(st.reason, 'dirty');
  assert.match(st.message, /uncommitted changes: M a\.js/);
  assert.ok(st.manual.some((c) => /stash/.test(c)) && st.manual.some((c) => /pull --ff-only origin prod/.test(c)));
  assert.strictEqual(st.behind, 1, 'still reports how far behind it is');
  assert.strictEqual(g(appDir, 'rev-parse', 'HEAD'), headDirty, 'a dirty folder is never touched');
  assert.strictEqual(fs.readFileSync(path.join(appDir, 'a.js'), 'utf8'), 'local edit\n');
  g(appDir, 'checkout', '--', 'a.js');
  // Untracked files don't count as dirty.
  write(appDir, 'notes.txt', 'mine\n');
  assert.strictEqual((await up.inspect()).state, 'available');
  fs.unlinkSync(path.join(appDir, 'notes.txt'));

  // Not on prod: untouched.
  g(appDir, 'checkout', '-q', '-b', 'experiment');
  st = await up.update();
  assert.strictEqual(st.state, 'blocked');
  assert.strictEqual(st.reason, 'not-prod');
  assert.match(st.message, /branch "experiment"/);
  assert.ok(st.manual.some((c) => /checkout prod/.test(c)));
  g(appDir, 'checkout', '-q', 'prod');

  // Not a fast-forward (a local commit on prod): untouched.
  write(appDir, 'local.js', 'x\n');
  commit(appDir, 'local hack');
  const headLocal = g(appDir, 'rev-parse', 'HEAD');
  st = await up.update();
  assert.strictEqual(st.state, 'blocked');
  assert.strictEqual(st.reason, 'diverged');
  assert.strictEqual(st.ahead, 1);
  assert.strictEqual(g(appDir, 'rev-parse', 'HEAD'), headLocal);
  assert.ok(st.manual.some((c) => /reset --hard origin\/prod/.test(c)));
  g(appDir, 'reset', '-q', '--hard', 'HEAD~1');
  assert.strictEqual((await up.update()).state, 'ready', 'after fixing it by hand, updating works again');

  // Not a git checkout at all.
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  const notGit = await new Updater({ dir: plain, electronPath: electron, git: (dir, args) => { if (args[0] === 'rev-parse') throw new Error('not a git repository'); return ''; } }).inspect();
  assert.strictEqual(notGit.state, 'blocked');
  assert.strictEqual(notGit.reason, 'not-git');
  // A folder inside some other repository is not "its own checkout" either.
  const nested = path.join(appDir, 'node_modules', 'electron');
  assert.strictEqual((await new Updater({ dir: nested, electronPath: electron }).inspect()).reason, 'not-git');

  // Restart plan: wait for running jobs; relaunch, or install-then-launch after a lockfile change.
  assert.deepStrictEqual(planRestart({ running: 2, needsInstall: false }), { waitFor: 2, mode: 'relaunch' });
  assert.deepStrictEqual(planRestart({ running: 0, needsInstall: true }), { waitFor: 0, mode: 'install-then-launch' });
  const ps = installScript({ pid: 4242, dir: "C:\\Users\\o'neil\\Burrowby\\app", electronPath: 'C:\\x\\electron.exe', logFile: 'C:\\x\\log.txt' });
  assert.match(ps, /Wait-Process -Id 4242/);
  assert.match(ps, /npm ci --no-audit --no-fund/);
  assert.match(ps, /if \(Test-Path -LiteralPath 'C:\\x\\electron\.exe'\)/, 'checks the shortcut target before relaunching');
  assert.match(ps, /Start-Process -FilePath 'C:\\x\\electron\.exe'/);
  assert.match(ps, /o''neil/, 'paths are quoted for PowerShell');
  assert.ok(ps.indexOf('Wait-Process') < ps.indexOf('npm ci') && ps.indexOf('npm ci') < ps.indexOf('Start-Process'), 'wait, install, then launch');

  // Engine: while a restart waits, running jobs finish but queued ones don't start; they resume after.
  let release1;
  const claude = { exe: () => 'claude.exe', modelFor: () => 'm', cwd: tmp, stream: () => new Promise((r) => { release1 = () => r({ text: 'ok', stopReason: 'end_turn' }); }) };
  const engine = new Engine({ dir: path.join(tmp, 'data'), claude });
  engine.setConcurrency(1);
  const running = engine.createJob('first', 'any');
  const queued = engine.createJob('second', 'any');
  assert.strictEqual(running.status, 'running');
  engine.holdNewJobs(true);
  assert.strictEqual(engine.runningCount(), 1);
  release1();
  for (let i = 0; i < 50 && running.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(running.status, 'done', 'the running job finishes');
  assert.strictEqual(queued.status, 'queued', 'no new job starts while a restart is pending');
  assert.strictEqual(engine.runningCount(), 0, 'restart may proceed');
  engine.saveNow();
  assert.strictEqual(new Engine({ dir: path.join(tmp, 'data'), claude }).jobById(queued.id).status, 'queued', 'queued jobs survive the restart');
  engine.holdNewJobs(false);
  assert.strictEqual(queued.status, 'running', 'cancelling the restart resumes the queue');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK: self-update (up to date, fast-forward after release, lockfile -> npm ci after exit, missing electron -> error, dirty / not prod / diverged / not git -> untouched with commands), restart plan + install helper, jobs held during restart, queued jobs survive');
};
