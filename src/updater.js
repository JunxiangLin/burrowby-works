// Self-update: keeps the folder the app runs from (app.getAppPath()) at origin/prod.
// It only ever fast-forwards a clean checkout of the prod branch; anything else is
// left untouched and reported with the commands to fix it by hand.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRANCH = 'prod';
const LOCKFILE = 'package-lock.json';

function runGit(dir, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(`git ${args[0]}: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' ')}`), { code: err.code }));
      resolve(String(stdout).trim());
    });
  });
}

const same = (a, b) => path.resolve(a).toLowerCase().replace(/[\\/]+$/, '') === path.resolve(b).toLowerCase().replace(/[\\/]+$/, '');
const short = (sha) => String(sha || '').slice(0, 7);

class Updater {
  // dir: the app's folder. electronPath: the electron.exe a shortcut launches (must survive updates).
  constructor({ dir, electronPath, git = runGit, exists = fs.existsSync }) {
    this.dir = path.resolve(dir);
    this.electronPath = electronPath;
    this.git = (args) => git(this.dir, args);
    this.exists = exists;
  }

  manual(reason) {
    const d = `"${this.dir}"`;
    const pull = [`git -C ${d} pull --ff-only origin ${BRANCH}`, `cd ${d}`, 'npm ci   (only if package-lock.json changed; close the app first)'];
    switch (reason) {
      case 'dirty': return [`git -C ${d} status`, `git -C ${d} stash   (or commit / discard your local changes)`, ...pull];
      case 'not-prod': return [`git -C ${d} status`, `git -C ${d} checkout ${BRANCH}`, ...pull];
      case 'diverged': return [`git -C ${d} log --oneline origin/${BRANCH}..HEAD   (commits only in this folder)`, `git -C ${d} reset --hard origin/${BRANCH}   (only if you don't need those commits)`, ...pull.slice(1)];
      case 'not-git': return [`git clone -b ${BRANCH} <repository URL> ${d}`, `cd ${d}`, 'npm ci'];
      default: return pull;
    }
  }

  // Where the folder stands relative to origin/prod. Fetches first; never changes files.
  async inspect() {
    let top;
    try { top = await this.git(['rev-parse', '--show-toplevel']); } catch { return this.blocked('not-git', 'The app is not running from a git checkout, so it cannot update itself.'); }
    if (!same(top, this.dir)) return this.blocked('not-git', `The app folder is inside another repository (${top}), not a checkout of its own.`);
    const branch = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const head = await this.git(['rev-parse', 'HEAD']);
    await this.git(['fetch', '--quiet', 'origin', BRANCH]);
    const remote = await this.git(['rev-parse', `origin/${BRANCH}`]);
    const behind = Number(await this.git(['rev-list', '--count', `HEAD..origin/${BRANCH}`])) || 0;
    const ahead = Number(await this.git(['rev-list', '--count', `origin/${BRANCH}..HEAD`])) || 0;
    const base = { head: short(head), remote: short(remote), behind, ahead, branch };
    if (branch !== BRANCH) return this.blocked('not-prod', `The app folder is on branch "${branch}", not ${BRANCH}.`, base);
    // Untracked files never block a fast-forward of tracked ones; modified tracked files do.
    const dirty = await this.git(['status', '--porcelain', '--untracked-files=no']);
    if (dirty) return this.blocked('dirty', `The app folder has uncommitted changes: ${dirty.split('\n').slice(0, 4).map((l) => l.trim()).join(', ')}${dirty.split('\n').length > 4 ? ', …' : ''}.`, base);
    if (ahead) return this.blocked('diverged', `The app folder has ${ahead} commit${ahead === 1 ? '' : 's'} that origin/${BRANCH} doesn't, so it can't fast-forward.`, base);
    return { state: behind ? 'available' : 'up-to-date', ...base };
  }

  blocked(reason, message, extra = {}) {
    return { state: 'blocked', reason, message, manual: this.manual(reason), ...extra };
  }

  // Fast-forward to origin/prod. Never runs npm in-process: replacing node_modules
  // while electron.exe is running would break the binary the shortcut launches,
  // so a lockfile change is reported as needsInstall and done after the app exits.
  async update() {
    const st = await this.inspect();
    if (st.state !== 'available') return st;
    const from = await this.git(['rev-parse', 'HEAD']);
    await this.git(['merge', '--ff-only', '--quiet', `origin/${BRANCH}`]);
    const to = await this.git(['rev-parse', 'HEAD']);
    const changes = Number(await this.git(['rev-list', '--count', `${from}..${to}`])) || 0;
    const files = (await this.git(['diff', '--name-only', from, to])).split('\n').filter(Boolean);
    const needsInstall = files.includes(LOCKFILE);
    const subjects = (await this.git(['log', '--format=%h %s', '--first-parent', `${from}..${to}`])).split('\n').filter(Boolean).slice(0, 10);
    if (this.electronPath && !this.exists(this.electronPath)) {
      return { state: 'error', message: `Updated to ${short(to)}, but ${this.electronPath} is missing. Run "npm ci" in ${this.dir} before starting the app again.`, from: short(from), to: short(to), changes, needsInstall: true, manual: [`cd "${this.dir}"`, 'npm ci'] };
    }
    return { state: 'ready', from: short(from), to: short(to), changes, needsInstall, subjects };
  }
}

// PowerShell run after the app exits when package-lock.json changed: wait for the
// app's process, `npm ci`, make sure the shortcut's electron.exe exists, relaunch.
function installScript({ pid, dir, electronPath, logFile }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return [
    '$ErrorActionPreference = "Continue"',
    `$log = ${q(logFile)}`,
    `"[$(Get-Date -Format o)] waiting for Burrowby Works (pid ${pid}) to exit" | Out-File -FilePath $log -Encoding utf8`,
    `try { Wait-Process -Id ${Number(pid)} -Timeout 120 -ErrorAction SilentlyContinue } catch {}`,
    `Set-Location -LiteralPath ${q(dir)}`,
    '"[$(Get-Date -Format o)] npm ci" | Out-File -FilePath $log -Append -Encoding utf8',
    'npm ci --no-audit --no-fund 2>&1 | Out-File -FilePath $log -Append -Encoding utf8',
    `if (Test-Path -LiteralPath ${q(electronPath)}) {`,
    `  "[$(Get-Date -Format o)] relaunching" | Out-File -FilePath $log -Append -Encoding utf8`,
    `  Start-Process -FilePath ${q(electronPath)} -ArgumentList ${q(`"${dir}"`)} -WorkingDirectory ${q(dir)}`,
    '} else {',
    `  "[$(Get-Date -Format o)] electron.exe missing after npm ci" | Out-File -FilePath $log -Append -Encoding utf8`,
    `  Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${q(`Burrowby Works updated, but installing its dependencies failed, so it can't start. Open a terminal in ${dir} and run: npm ci. Log: ${logFile}`)}, 'Burrowby Works update') | Out-Null`,
    '}',
  ].join('\r\n');
}

// What a restart has to do: wait for running jobs first (queued ones stay queued and
// resume after the restart), then relaunch directly or via the install helper.
function planRestart({ running, needsInstall }) {
  return { waitFor: running, mode: needsInstall ? 'install-then-launch' : 'relaunch' };
}

module.exports = { Updater, installScript, planRestart, BRANCH };
