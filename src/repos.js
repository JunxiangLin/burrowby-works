// Project repositories: managed clones under %USERPROFILE%\Burrowby\projects,
// per-task git worktrees on feature branches, and the push / PR / merge /
// release steps. Only the app runs these; worker agents never push.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.homedir(), 'Burrowby');
const PROJECTS = path.join(ROOT, 'projects');
const WORKTREES = path.join(ROOT, 'worktrees');
const PROD = 'prod';
const DEV = 'dev';

// Never show credentials embedded in a URL, or tokens that leak into output.
function redact(s) {
  return String(s == null ? '' : s)
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{10,})\b/g, '[redacted]');
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function run(cmd, args, { cwd, env, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: env || process.env, timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = redact((stderr || stdout || err.message || '').toString().trim().split('\n').slice(-4).join(' '));
        return reject(Object.assign(new Error(`${cmd} ${args[0]}: ${msg}`), { code: err.code, stderr }));
      }
      resolve(stdout.toString());
    });
  });
}
const git = (cwd, ...args) => run('git', args, { cwd });

class Repos {
  // appDir: the folder the running app was launched from; workers may never touch it.
  // gh: how to call the GitHub CLI (injected so tests can fake it).
  constructor({ appDir, root = ROOT, gh } = {}) {
    this.appDir = appDir ? path.resolve(appDir) : null;
    this.root = root;
    this.projectsDir = path.join(root, 'projects');
    this.worktreesDir = path.join(root, 'worktrees');
    this.gh = gh || ((args, opts) => run('gh', args, opts));
  }

  clonePath(key) { return path.join(this.projectsDir, String(key).toUpperCase()); }
  worktreeRoot(key) { return path.join(this.worktreesDir, String(key).toUpperCase()); }

  assertSafe(dir) {
    if (this.appDir && (isInside(dir, this.appDir) || isInside(this.appDir, dir))) {
      throw new Error(`Refusing to work in ${dir}: it overlaps the folder this app runs from (${this.appDir}).`);
    }
    if (!isInside(dir, this.root)) throw new Error(`Refusing to work outside ${this.root}: ${dir}`);
  }

  async ghStatus() {
    try {
      await this.gh(['auth', 'status'], { timeout: 20000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed.' : 'GitHub CLI is not signed in. Run `gh auth login` in a terminal.' };
    }
  }

  // Clone (or reuse) the project's managed clone and make sure prod and dev exist.
  // source: a GitHub URL / any git URL, or a local folder path.
  async setup(key, source) {
    const dest = this.clonePath(key);
    this.assertSafe(dest);
    fs.mkdirSync(this.projectsDir, { recursive: true });
    if (!fs.existsSync(path.join(dest, '.git'))) {
      if (!source) throw new Error('Give a GitHub URL or a local folder path.');
      await run('git', ['clone', source, dest], { timeout: 600000 });
    } else if (source) {
      await git(dest, 'remote', 'set-url', 'origin', source);
    }
    await git(dest, 'fetch', 'origin', '--prune');
    const remoteBranches = (await git(dest, 'branch', '-r', '--format=%(refname:short)')).split('\n').map((s) => s.trim()).filter(Boolean);
    const has = (b) => remoteBranches.includes(`origin/${b}`);
    // Base for missing branches: origin's default branch.
    let head = '';
    try { head = (await git(dest, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).trim(); } catch { head = remoteBranches[0] || ''; }
    const created = [];
    for (const b of [PROD, DEV]) {
      if (has(b)) continue;
      const base = b === DEV && has(PROD) ? `origin/${PROD}` : head || 'HEAD';
      await git(dest, 'push', 'origin', `${base}:refs/heads/${b}`);
      created.push(b);
    }
    await git(dest, 'fetch', 'origin', '--prune');
    const url = redact((await git(dest, 'remote', 'get-url', 'origin')).trim());
    return { path: dest, url, github: /github\.com[/:]/i.test(url), created };
  }

  // A fresh feature branch from origin/dev, checked out in its own worktree.
  async createWorktree(key, n, title) {
    const clone = this.clonePath(key);
    await git(clone, 'fetch', 'origin', DEV);
    let branch = `feature/${key}-${n}-${slug(title)}`;
    const exists = async (b) => { try { await git(clone, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } };
    for (let i = 2; await exists(branch); i++) branch = `feature/${key}-${n}-${slug(title)}-${i}`;
    const dir = path.join(this.worktreeRoot(key), branch.replace(/^feature\//, '').replace(/[^A-Za-z0-9._-]/g, '-'));
    this.assertSafe(dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(clone, 'worktree', 'add', '-b', branch, dir, `origin/${DEV}`);
    const base = (await git(dir, 'rev-parse', 'HEAD')).trim();
    return { branch, dir, base };
  }

  // After the agent: commit leftovers, measure the diff against the base.
  async finishWorktree(dir, base, message) {
    this.assertSafe(dir);
    const dirty = (await git(dir, 'status', '--porcelain')).trim();
    let autoCommitted = false;
    if (dirty) {
      await git(dir, 'add', '-A');
      await run('git', ['-c', 'user.name=Burrowby Works', '-c', 'user.email=burrowby@localhost', 'commit', '-m', `${message} (uncommitted changes, committed by the app)`], { cwd: dir });
      autoCommitted = true;
    }
    const head = (await git(dir, 'rev-parse', 'HEAD')).trim();
    const commits = Number((await git(dir, 'rev-list', '--count', `${base}..HEAD`)).trim()) || 0;
    const numstat = (await git(dir, 'diff', '--numstat', `${base}..HEAD`)).trim();
    const files = numstat ? numstat.split('\n').map((l) => { const [a, d, f] = l.split('\t'); return { file: f, add: a === '-' ? 0 : +a, del: d === '-' ? 0 : +d }; }) : [];
    return { head, commits, autoCommitted, files, insertions: files.reduce((s, f) => s + f.add, 0), deletions: files.reduce((s, f) => s + f.del, 0) };
  }

  async push(key, branch) {
    const clone = this.clonePath(key);
    await git(clone, 'push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`);
  }

  async openPr(key, branch, title, body) {
    const clone = this.clonePath(key);
    const out = await this.gh(['pr', 'create', '--base', DEV, '--head', branch, '--title', title, '--body', body], { cwd: clone, timeout: 60000 });
    const url = (out.match(/https:\/\/github\.com\/\S+\/pull\/\d+/) || [])[0];
    if (!url) throw new Error(`gh pr create gave no PR link: ${redact(out).slice(0, 200)}`);
    return { url, number: Number(url.split('/').pop()) };
  }

  async removeWorktree(key, dir) {
    this.assertSafe(dir);
    await git(this.clonePath(key), 'worktree', 'remove', '--force', dir);
  }

  async listPrs(key) {
    const out = await this.gh(['pr', 'list', '--state', 'open', '--json', 'number,title,url,baseRefName,headRefName,isDraft', '--limit', '30'], { cwd: this.clonePath(key), timeout: 30000 });
    return JSON.parse(out || '[]');
  }

  // Only ever merges into dev. Releases to prod are a separate, user-only step.
  async mergePr(key, number) {
    const clone = this.clonePath(key);
    const info = JSON.parse(await this.gh(['pr', 'view', String(number), '--json', 'number,baseRefName,state,url,title'], { cwd: clone, timeout: 30000 }));
    if (info.baseRefName !== DEV) throw new Error(`PR #${number} targets ${info.baseRefName}. Only PRs into ${DEV} can be merged here; ${PROD} releases need the owner's "Release to prod" button.`);
    if (info.state !== 'OPEN') throw new Error(`PR #${number} is ${info.state.toLowerCase()}.`);
    await this.gh(['pr', 'merge', String(number), '--merge', '--delete-branch'], { cwd: clone, timeout: 60000 });
    return { number: info.number, url: info.url, title: info.title, merged: true };
  }

  // Owner-only: fast-forward prod to dev on the remote. Refuses if not a fast-forward.
  async releaseToProd(key) {
    const clone = this.clonePath(key);
    await git(clone, 'fetch', 'origin', '--prune');
    const dev = (await git(clone, 'rev-parse', `origin/${DEV}`)).trim();
    const prod = (await git(clone, 'rev-parse', `origin/${PROD}`)).trim();
    if (dev === prod) return { released: false, note: `${PROD} is already at ${DEV}.` };
    try { await git(clone, 'merge-base', '--is-ancestor', prod, dev); } catch { throw new Error(`${PROD} has commits that ${DEV} doesn't. Merge ${PROD} into ${DEV} first.`); }
    const count = Number((await git(clone, 'rev-list', '--count', `${prod}..${dev}`)).trim());
    await git(clone, 'push', 'origin', `${dev}:refs/heads/${PROD}`);
    return { released: true, commits: count, sha: dev.slice(0, 7) };
  }
}

module.exports = { Repos, redact, slug, isInside, ROOT, PROJECTS, WORKTREES, PROD, DEV };
