// Project repositories: managed clones under %USERPROFILE%\Burrowby\projects,
// per-task git worktrees on feature branches, and the push / PR / merge /
// release steps. Only the app runs these; worker agents never push.
const { execFile, exec } = require('child_process');
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

  // A detached checkout of a pushed PR branch, for QA. Commits QA adds are pushed back with pushHead.
  async createReviewWorktree(key, branch) {
    const clone = this.clonePath(key);
    await git(clone, 'fetch', 'origin', branch);
    const dir = path.join(this.worktreeRoot(key), `qa-${branch.replace(/^feature\//, '').replace(/[^A-Za-z0-9._-]/g, '-')}`);
    this.assertSafe(dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(clone, 'worktree', 'add', '--detach', dir, `origin/${branch}`);
    const base = (await git(dir, 'rev-parse', 'HEAD')).trim();
    return { branch, dir, base };
  }

  async pushHead(dir, branch) {
    this.assertSafe(dir);
    if (!/^feature\//.test(branch)) throw new Error(`Refusing to push to ${branch}: only feature branches.`);
    await git(dir, 'push', 'origin', `HEAD:refs/heads/${branch}`);
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

  // ---------- auto-merge support ----------
  // The project's check command: explicit, or `npm run check` / `npm test` from package.json.
  detectCheck(dir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const sc = pkg.scripts || {};
      if (sc.check) return 'npm run check';
      if (sc.test && !/no test specified/.test(sc.test)) return 'npm test';
    } catch { /* not a Node project */ }
    return '';
  }

  // Merge the latest dev into the worktree locally (never pushed), so a conflict
  // shows up before GitHub and the check runs on what the merge will produce.
  // keep: on a conflict leave the merge in progress (for a coder to resolve) instead of aborting it.
  async mergeDevInto(dir, { keep = false } = {}) {
    this.assertSafe(dir);
    await git(dir, 'fetch', 'origin', DEV);
    try {
      await run('git', ['-c', 'user.name=Burrowby Works', '-c', 'user.email=burrowby@localhost', 'merge', '--no-ff', '--no-edit', `origin/${DEV}`], { cwd: dir });
      return { conflict: false };
    } catch (e) {
      const files = await this.conflictFiles(dir);
      // No conflicting files means the merge failed for another reason: surface it, don't call it a conflict.
      if (!files.length) { await git(dir, 'merge', '--abort').catch(() => {}); throw e; }
      if (!keep) await git(dir, 'merge', '--abort').catch(() => {});
      return { conflict: true, files };
    }
  }

  async conflictFiles(dir) {
    return (await git(dir, 'diff', '--name-only', '--diff-filter=U').catch(() => '')).trim().split('\n').filter(Boolean);
  }

  async abortMerge(dir) {
    this.assertSafe(dir);
    await git(dir, 'merge', '--abort').catch(() => {});
  }

  // After a coder edited the conflicted files: refuse leftover conflict markers, commit the merge
  // (the app commits, not the agent), and confirm dev is really part of the branch.
  async finishDevMerge(dir, files) {
    this.assertSafe(dir);
    const marker = /^(<{7}|>{7})(\s|$)/m;
    const left = files.filter((f) => { try { return marker.test(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return false; } });
    if (left.length) return { ok: false, reason: `conflict markers are still in ${left.join(', ')}` };
    const unresolved = await this.conflictFiles(dir);
    const inMerge = fs.existsSync(path.resolve(dir, (await git(dir, 'rev-parse', '--git-path', 'MERGE_HEAD')).trim()));
    if (inMerge) {
      await git(dir, 'add', '-A');
      await run('git', ['-c', 'user.name=Burrowby Works', '-c', 'user.email=burrowby@localhost', 'commit', '--no-edit'], { cwd: dir });
    } else if (unresolved.length) return { ok: false, reason: `still unresolved: ${unresolved.join(', ')}` };
    try { await git(dir, 'merge-base', '--is-ancestor', `origin/${DEV}`, 'HEAD'); } catch { return { ok: false, reason: `${DEV} is not part of the branch after the merge` }; }
    return { ok: true };
  }

  // Run the check command in the worktree. `env` is the scrubbed worker environment:
  // this runs project code, so it gets no secrets either.
  runCheck(dir, cmd, env, timeout = 15 * 60 * 1000) {
    this.assertSafe(dir);
    const started = Date.now();
    return new Promise((resolve) => {
      exec(cmd, { cwd: dir, env, timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = redact(`${stdout || ''}${stderr ? `\n${stderr}` : ''}`).trim();
        resolve({ cmd, ok: !err, exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), ms: Date.now() - started, output: out.slice(-4000) });
      });
    });
  }

  // GitHub computes mergeability lazily; poll briefly while it is UNKNOWN.
  async waitMergeable(key, number, { tries = 10, delayMs = 3000 } = {}) {
    let info = null;
    for (let i = 0; i < tries; i++) {
      info = JSON.parse(await this.gh(['pr', 'view', String(number), '--json', 'mergeable,mergeStateStatus,baseRefName,state'], { cwd: this.clonePath(key), timeout: 30000 }));
      if (info.mergeable !== 'UNKNOWN') break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return info;
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
    const preview = await this.releasePreview(key);
    if (preview.diverged) throw new Error(preview.summary);
    if (!preview.ahead) return { released: false, note: preview.summary, preview };
    return this.release(key, preview.devSha);
  }

  // What "Release to prod" would ship, always against freshly fetched remote refs:
  // the commits in origin/prod..origin/dev and the PRs merged in them.
  async releasePreview(key) {
    const clone = this.clonePath(key);
    await git(clone, 'fetch', 'origin', '--prune');
    const devSha = (await git(clone, 'rev-parse', `origin/${DEV}`)).trim();
    const prodSha = (await git(clone, 'rev-parse', `origin/${PROD}`)).trim();
    const count = async (range) => Number((await git(clone, 'rev-list', '--count', range)).trim()) || 0;
    const ahead = await count(`${prodSha}..${devSha}`); // in dev, not yet in prod
    const behind = await count(`${devSha}..${prodSha}`); // in prod but not in dev
    const log = ahead ? (await git(clone, 'log', '--first-parent', '--format=%h%x09%s', `${prodSha}..${devSha}`)).trim().split('\n').filter(Boolean) : [];
    const commits = log.map((l) => { const [sha, ...rest] = l.split('\t'); return { sha, subject: rest.join('\t') }; });
    const prs = [...new Set(commits.map((c) => (c.subject.match(/^Merge pull request #(\d+)/) || [])[1]).filter(Boolean).map(Number))];
    const short = (s) => s.slice(0, 7);
    const diverged = behind > 0;
    const summary = diverged
      ? `${PROD} has ${behind} commit${behind === 1 ? '' : 's'} that ${DEV} doesn't, so a fast-forward release isn't possible. Merge ${PROD} into ${DEV} first.`
      : ahead
        ? `${ahead} commit${ahead === 1 ? '' : 's'} on ${DEV} not yet in ${PROD}${prs.length ? ` (PR${prs.length === 1 ? '' : 's'} ${prs.map((n) => `#${n}`).join(', ')})` : ''}.`
        : `Nothing to release: ${PROD} already has everything in ${DEV} (both at ${short(devSha)}).`;
    return { devSha, prodSha, dev: short(devSha), prod: short(prodSha), ahead, behind, diverged, prs, commits: commits.slice(0, 30), summary };
  }

  // Owner-only: fast-forward prod to exactly `sha` (the previewed dev tip). A plain
  // push is rejected by the remote unless it is a fast-forward.
  async release(key, sha) {
    const clone = this.clonePath(key);
    await git(clone, 'fetch', 'origin', '--prune');
    const prodSha = (await git(clone, 'rev-parse', `origin/${PROD}`)).trim();
    try { await git(clone, 'merge-base', '--is-ancestor', sha, `origin/${DEV}`); } catch { throw new Error(`Commit ${sha.slice(0, 7)} is no longer on ${DEV}. Refresh and try again.`); }
    try { await git(clone, 'merge-base', '--is-ancestor', prodSha, sha); } catch { throw new Error(`${PROD} moved and is no longer behind ${sha.slice(0, 7)}. Refresh and try again.`); }
    const commits = Number((await git(clone, 'rev-list', '--count', `${prodSha}..${sha}`)).trim()) || 0;
    if (!commits) return { released: false, note: `Nothing to release: ${PROD} is already at ${sha.slice(0, 7)}.` };
    await git(clone, 'push', 'origin', `${sha}:refs/heads/${PROD}`);
    return { released: true, commits, sha: sha.slice(0, 7), from: prodSha.slice(0, 7) };
  }
}

module.exports = { Repos, redact, slug, isInside, ROOT, PROJECTS, WORKTREES, PROD, DEV };
