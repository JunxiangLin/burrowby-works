// Burrowby Works engine. Lives in the Electron main process so the desktop
// pet, the Assistant, the Factory and the Board all share one factory: one
// job list, one scheduler, one foreman conversation. Data model, prompts and
// foreman tools follow the Burrowby Works artifact.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { redact } = require('./repos');

// ---------- constants (from the artifact) ----------
const SPECIES = ['bunny', 'cat', 'bear', 'frog', 'chick', 'axolotl'];
const NAMES = ['Mochi', 'Pip', 'Biscuit', 'Tofu', 'Clover', 'Wasabi', 'Juniper', 'Noodle', 'Pebble', 'Sprout', 'Maple', 'Dumpling', 'Bean', 'Kiwi', 'Waffle', 'Fig', 'Bao', 'Pudding', 'Sesame', 'Nori', 'Olive', 'Button', 'Toast'];
const DEFAULT_WORKERS = [
  { id: 'w_mochi', name: 'Mochi', species: 'bunny', specialty: 'Researcher. Explains topics clearly, compares options side by side, and says plainly what is uncertain.' },
  { id: 'w_biscuit', name: 'Biscuit', species: 'bear', specialty: 'Coder. Writes clean, working code with brief comments and a short usage example.' },
  { id: 'w_juniper', name: 'Juniper', species: 'cat', specialty: 'Writer. Drafts emails, posts and docs in a warm, plain voice. Keeps things short.' },
  { id: 'w_clover', name: 'Clover', species: 'frog', specialty: 'Analyst. Breaks problems into steps, makes rough estimates, and ends with a clear recommendation.' },
];
const COLS = [['backlog', 'Backlog'], ['todo', 'To do'], ['progress', 'In progress'], ['testing', 'Testing'], ['review', 'Review'], ['done', 'Done']];
const PRIO = { low: 'Low', med: 'Medium', high: 'High', urgent: 'Urgent' };
const KINDS = { note: 'Note', doc: 'Reference doc', data: 'Data', style: 'Style guide', snippet: 'Snippet' };
const COLORS = ['#DC5434', '#3E8FB0', '#2C8C58', '#8E6BD6', '#D99A1E', '#C2497F'];
const STATUS_LABEL = { queued: 'queued', running: 'running', done: 'shipped', failed: 'failed', cancelled: 'stopped' };
const MAX_WORKERS = 12, MAX_OUTPUT = 60000, MAX_CTX = 80000, MAX_JOBS = 300, CTX_BUDGET = 60000;
const JOB_FIELDS = ['id', 'n', 'text', 'pref', 'workerId', 'tier', 'status', 'createdAt', 'startedAt', 'firstTokenAt', 'finishedAt', 'output', 'error', 'tierApplied', 'inTok', 'outTok', 'simulated', 'truncated', 'ctx', 'taskId', 'projectId', 'model', 'byForeman', 'errorDetail',
  'kind', 'branch', 'worktree', 'pr', 'prError', 'diff', 'steps', 'proposals', 'merge', 'qaFor', 'qa'];
const READ_TOOLS = new Set(['get_factory_status', 'get_job', 'list_projects', 'list_tasks', 'search_context', 'list_prs']);
const CAPABILITIES = ['text', 'code', 'pm', 'qa'];
const QA_NAMES = ['Mochi', 'Pebble', 'Olive', 'Button', 'Toast'];
const QA_SPECIALTY = 'QA tester. Reads the diff, runs the existing tests, adds tests where they are missing, checks every acceptance criterion, and reports plainly what passed and what failed.';
const MAX_QA_NOTES = 8;

// Coding jobs: the only tools a worker agent gets, and the shell commands it may run.
// Everything else is denied without asking (--permission-mode dontAsk).
const CODE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];
const CODE_ALLOWED = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(git restore:*)', 'Bash(git rm:*)', 'Bash(git mv:*)',
  'Bash(npm install:*)', 'Bash(npm ci:*)', 'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(node:*)', 'Bash(npx:*)',
  'Bash(python:*)', 'Bash(python3:*)', 'Bash(pytest:*)',
  'Bash(docker build:*)', 'Bash(docker compose:*)',
];
const CODE_DENIED = ['Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git reset:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git branch:*)', 'Bash(gh:*)', 'Bash(npm publish:*)', 'Bash(curl:*)', 'Bash(wget:*)'];
const CODE_MAX_TURNS = 40;
const CODE_TIMEOUT_MS = 25 * 60 * 1000;

// Environment for worker agents: no tokens or secrets, and git can neither
// prompt for nor use stored credentials, so an agent's own `git push` fails
// even if a script tries it. The app pushes with the normal environment.
function workerEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|CREDENTIAL|PRIVATE_KEY/i.test(k)) env[k] = v;
  Object.assign(env, {
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'remote.origin.pushurl', GIT_CONFIG_VALUE_1: 'https://workers-cannot-push.invalid/',
  });
  return env;
}

function codeSystemPrompt(w, ref, wt) {
  return `You are ${w.name}, a coding worker pet at Burrowby Works. ${w.specialty || ''}

You are working on ${ref} in a git worktree on branch ${wt.branch}. The current directory is that worktree.
Rules:
- Only read and change files inside the current directory. Never use cd.
- Run exactly one simple command per Bash call: no &&, ;, | or redirection. Commands outside the allowlist are denied automatically; if one is denied, carry on without it.
- Allowed shell commands: git status/diff/add/commit/log/show/restore/rm/mv, npm install/ci/test/run, node, npx, python, pytest, docker build, docker compose.
- Commit your work with git add and git commit. Start each commit message with "${ref}:".
- Never push, never switch branches, never touch the dev or prod branches. The app pushes your branch and opens the pull request.
- Do not print, copy or commit secrets, tokens or credentials.`;
}

function qaSystemPrompt(w, ref) {
  return `You are ${w.name}, a QA worker pet at Burrowby Works. ${w.specialty || ''}

You are verifying ${ref} in a git worktree checked out at the coder's pull request. The current directory is that worktree.
Rules:
- Only read and change files inside the current directory. Never use cd.
- Run exactly one simple command per Bash call: no &&, ;, | or redirection. Commands outside the allowlist are denied automatically; if one is denied, carry on without it.
- Allowed shell commands: git status/diff/add/commit/log/show/restore/rm/mv, npm install/ci/test/run, node, npx, python, pytest, docker build, docker compose.
- Do not change the code under test to make it pass. You may only add or fix tests. Commit any tests you add with a message that starts with "${ref}:".
- Never push, never switch branches. The app pushes passing work.
- Do not print, copy or commit secrets, tokens or credentials.`;
}

// The QA worker's last line is "VERDICT: PASS" or "VERDICT: FAIL"; everything before it is the notes.
function parseQa(text) {
  const s = String(text || '').trim();
  const ms = [...s.matchAll(/^\W*VERDICT\s*:\s*(PASS|FAIL)\b.*$/gim)];
  if (!ms.length) return { verdict: null, notes: s };
  const m = ms[ms.length - 1];
  return { verdict: m[1].toUpperCase() === 'PASS' ? 'pass' : 'fail', notes: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim() };
}

const PM_INSTRUCTIONS = `

You are acting as the project manager. After your notes, end your reply with a fenced JSON block of proposed tickets, exactly like:
\`\`\`json
{"tickets": [{"title": "under 80 characters", "description": "what to produce, with acceptance criteria", "priority": "low" | "med" | "high" | "urgent"}]}
\`\`\`
Propose 3 to 8 concrete, non-overlapping tickets that one worker can finish in one sitting.`;

// Pull proposed tickets out of a PM job's output.
function parseTickets(text) {
  const blocks = [...String(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of blocks.reverse()) {
    try {
      const d = JSON.parse(b);
      const arr = Array.isArray(d) ? d : Array.isArray(d.tickets) ? d.tickets : null;
      if (arr) return arr.filter((x) => x && x.title).slice(0, 12).map((x) => ({ title: String(x.title).slice(0, 140), desc: String(x.description || x.desc || ''), priority: PRIO[x.priority] ? x.priority : 'med', accepted: false }));
    } catch { /* try the next block */ }
  }
  return [];
}

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const tok = (s) => Math.round((s || '').length / 4);
const clone = (o) => JSON.parse(JSON.stringify(o));
const keyFrom = (name) => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const k = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] || 'PRJ').slice(0, 3);
  return k.toUpperCase();
};
const fmtDur = (ms) => (ms == null || isNaN(ms) ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- normalisers (shared by load and import) ----------
const normWorker = (w) => ({
  id: String(w.id), name: String(w.name).slice(0, 20), species: SPECIES.includes(w.species) ? w.species : 'bunny', specialty: String(w.specialty || '').slice(0, 1200),
  capability: CAPABILITIES.includes(w.capability) ? w.capability : /^\s*coder\b/i.test(w.specialty || '') ? 'code' : 'text',
});
const normForeman = (f) => ({ name: String((f && f.name) || 'Marmalade').slice(0, 20), species: f && SPECIES.includes(f.species) ? f.species : 'cat', tier: f && f.tier === 'default' ? 'default' : 'quick' });
function normJob(j) {
  const o = {};
  for (const k of JOB_FIELDS) if (j[k] !== undefined && j[k] !== null) o[k] = j[k];
  o.text = String(o.text || '');
  o.output = String(o.output || '').slice(0, MAX_OUTPUT);
  o.pref = o.pref || 'any';
  o.tier = ['quick', 'default', 'complex'].includes(o.tier) ? o.tier : 'default';
  if (!STATUS_LABEL[o.status]) o.status = 'failed';
  if (!Array.isArray(o.ctx)) delete o.ctx;
  return o;
}
const normRepo = (r) => (r && typeof r === 'object' && (r.source || r.path) ? { source: redact(r.source || ''), path: r.path || '', url: redact(r.url || ''), github: !!r.github, status: ['ready', 'setting-up', 'error'].includes(r.status) ? r.status : 'error', error: r.error ? redact(r.error) : '' } : null);
const normProject = (p) => ({ id: String(p.id), name: String(p.name).slice(0, 60), key: String(p.key || keyFrom(p.name)).toUpperCase().slice(0, 5), color: p.color || COLORS[0], desc: String(p.desc || ''), ctx: Array.isArray(p.ctx) ? p.ctx : [], seq: p.seq || 0, createdAt: p.createdAt || Date.now(), updatedAt: p.updatedAt, repo: normRepo(p.repo), lastRelease: p.lastRelease && p.lastRelease.sha ? p.lastRelease : null, autoMerge: p.autoMerge !== false, checkCmd: String(p.checkCmd || '').slice(0, 300) });
const normTask = (t) => ({ id: String(t.id), projectId: String(t.projectId), n: t.n || 0, title: String(t.title).slice(0, 140), desc: String(t.desc || ''), status: COLS.some((c) => c[0] === t.status) ? t.status : 'todo', priority: PRIO[t.priority] ? t.priority : 'med', assignee: t.assignee || '', labels: Array.isArray(t.labels) ? t.labels : [], due: t.due || '', ctx: Array.isArray(t.ctx) ? t.ctx : [], jobs: Array.isArray(t.jobs) ? t.jobs : [], qa: Array.isArray(t.qa) ? t.qa.slice(-MAX_QA_NOTES) : [], order: t.order || Date.now(), createdAt: t.createdAt || Date.now(), updatedAt: t.updatedAt });
const normCtx = (c) => ({ id: String(c.id), title: String(c.title || 'Untitled').slice(0, 120), kind: KINDS[c.kind] ? c.kind : 'note', tags: Array.isArray(c.tags) ? c.tags : [], content: String(c.content || '').slice(0, MAX_CTX), createdAt: c.createdAt || Date.now(), updatedAt: c.updatedAt });
const normMsg = (m) => ({ id: m.id || uid('m_'), role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text || '').slice(0, 8000), actions: Array.isArray(m.actions) ? m.actions.slice(0, 20).map(String) : [], t: m.t || 0, error: !!m.error });

class Engine extends EventEmitter {
  constructor({ dir, claude, repos = null }) {
    super();
    this.dir = dir;
    this.repos = repos; // Repos instance (src/repos.js); null disables coding jobs
    this.file = path.join(dir, 'works.json');
    this.claude = claude; // { exe(), modelFor(tier), run(opts), stream(opts), cwd }
    this.controllers = new Map(); // job id -> AbortController
    this.lastRateLimit = 0;
    this.chatBusy = false;
    this.chatCtl = null;
    this.load();
  }

  // ---------- persistence ----------
  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const d = readJson(this.file) || {};
    this.applyData(d, true);
    // Jobs that were running when the app closed did not finish.
    for (const j of this.jobs) {
      if (j.status === 'running') Object.assign(j, { status: 'failed', error: 'interrupted', finishedAt: j.finishedAt || Date.now() });
    }
  }

  applyData(d, initial) {
    const f = d.factory || {};
    this.workers = Array.isArray(f.workers) && f.workers.length ? f.workers.filter((w) => w && w.id && w.name).map(normWorker) : DEFAULT_WORKERS.map(normWorker);
    this.concurrency = [1, 2, 3].includes(f.concurrency) ? f.concurrency : 2;
    this.foreman = normForeman(f.foreman);
    this.autoAcceptPm = f.autoAcceptPm !== false;
    const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
    this.jobs = (d.jobs || []).filter((j) => j && j.id && j.text).map(normJob).sort(byCreated);
    this.projects = (d.projects || []).filter((p) => p && p.id && p.name).map(normProject).sort(byCreated);
    this.tasks = (d.tasks || []).filter((t) => t && t.id && t.projectId && t.title).map(normTask).sort(byCreated);
    this.contexts = (d.contexts || []).filter((c) => c && c.id).map(normCtx).sort(byCreated);
    this.chat = (d.chat || []).filter((m) => m && (m.text || (m.actions || []).length)).map(normMsg).slice(-40);
    if (!initial) this.save();
  }

  factoryDoc() {
    return { workers: this.workers.map((w) => ({ ...w })), concurrency: this.concurrency, foreman: { ...this.foreman }, autoAcceptPm: this.autoAcceptPm !== false };
  }

  exportDoc() {
    return {
      format: 'burrowby-works-export',
      version: 1,
      exportedAt: Date.now(),
      factory: this.factoryDoc(),
      jobs: this.jobs.map(normJob),
      projects: this.projects,
      tasks: this.tasks,
      contexts: this.contexts,
      chat: this.chat.filter((m) => !m.pending).map(normMsg),
    };
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    const data = { ...this.exportDoc(), jobs: this.jobs.slice(-MAX_JOBS).map(normJob) };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    return clone({
      factory: this.factoryDoc(),
      jobs: this.jobs,
      projects: this.projects,
      tasks: this.tasks,
      contexts: this.contexts,
      chat: this.chat,
      chatBusy: this.chatBusy,
      lastRateLimit: this.lastRateLimit,
    });
  }

  // Patches go to every window. Collections other than jobs are small, so
  // they are sent whole; jobs are sent one at a time as they change.
  emitPatch(patch) {
    this.emit('patch', clone(patch));
  }
  changed(...colls) {
    const patch = {};
    for (const c of colls) {
      if (c === 'factory') patch.factory = this.factoryDoc();
      else if (c === 'chat') {
        patch.chat = this.chat;
        patch.chatBusy = this.chatBusy;
      } else patch[c] = this[c];
    }
    this.save();
    this.emitPatch(patch);
  }
  jobChanged(j, { persist = true } = {}) {
    if (persist) this.save();
    this.emitPatch({ jobs: [j], lastRateLimit: this.lastRateLimit });
  }

  // ---------- lookups ----------
  byWorker(id) { return this.workers.find((w) => w.id === id); }
  jobById(id) { return this.jobs.find((j) => j.id === id); }
  jobByN(n) { return this.jobs.find((j) => j.n === Number(String(n).replace('#', ''))); }
  projectById(id) { return this.projects.find((p) => p.id === id); }
  taskById(id) { return this.tasks.find((t) => t.id === id); }
  ctxById(id) { return this.contexts.find((c) => c.id === id); }
  taskKey(t) { const p = this.projectById(t.projectId); return `${p ? p.key : 'TASK'}-${t.n}`; }
  findWorker(name) { if (!name) return null; const n = String(name).trim().toLowerCase(); return this.workers.find((w) => w.id === name || w.name.toLowerCase() === n) || null; }
  findProject(k) { const s = String(k || '').trim().toLowerCase(); return this.projects.find((p) => p.key.toLowerCase() === s || p.name.toLowerCase() === s || p.id === k) || null; }
  findTask(key) {
    const m = String(key || '').trim().toUpperCase().match(/^([A-Z0-9]+)-(\d+)$/);
    if (!m) return null;
    const p = this.projects.find((p) => p.key.toUpperCase() === m[1]);
    return (p && this.tasks.find((t) => t.projectId === p.id && t.n === +m[2])) || null;
  }
  lastJob(t) { const ids = t.jobs || []; for (let i = ids.length - 1; i >= 0; i--) { const j = this.jobById(ids[i]); if (j) return j; } return null; }
  isActive(j) { return j.status === 'queued' || j.status === 'running'; }
  workerBusy(w) { return this.jobs.some((j) => j.status === 'running' && j.workerId === w.id); }
  runMs(j) { return (j.finishedAt || Date.now()) - j.startedAt; }
  busyMs(w, win) {
    const from = Date.now() - win;
    let s = 0;
    for (const j of this.jobs) if (j.workerId === w.id && j.startedAt) { const a = Math.max(from, j.startedAt), b = j.finishedAt || Date.now(); if (b > a) s += b - a; }
    return s;
  }

  // ---------- jobs ----------
  createJob(text, pref = 'any', tier = 'default', extra = {}) {
    const n = this.jobs.reduce((m, j) => Math.max(m, j.n || 0), 0) + 1;
    const j = normJob({ id: uid('j_'), n, text: String(text).slice(0, 8000), pref, tier, status: 'queued', createdAt: Date.now(), output: '', ...extra });
    this.jobs.push(j);
    if (this.jobs.length > MAX_JOBS + 50) this.jobs = this.jobs.filter((x, i) => this.isActive(x) || i >= this.jobs.length - MAX_JOBS);
    this.jobChanged(j);
    this.schedule();
    return j;
  }

  contextBlock(ids, cap = CTX_BUDGET) {
    const es = (ids || []).map((id) => this.ctxById(id)).filter(Boolean);
    if (!es.length) return '';
    let out = '\nReference context. Use it where relevant and follow any style rules in it:\n';
    for (const e of es) {
      let body = e.content || '';
      const room = cap - out.length;
      if (room < 200) { out += '\n[Some context entries were left out for length.]\n'; break; }
      if (body.length > room) body = body.slice(0, room) + '\n[truncated]';
      out += `\n=== ${e.title} (${KINDS[e.kind] || e.kind}) ===\n${body}\n`;
    }
    return out;
  }

  buildPrompt(j, w) {
    return `You are ${w.name}, a worker in a small agent factory.\nYour specialty and instructions: ${w.specialty || 'Generalist. Handle any job carefully.'}\n\nComplete the job below. Reply with the finished work only, with no preamble or sign-off. Use Markdown where it helps. Keep it under about 500 words unless the job clearly needs more.\n${this.contextBlock(j.ctx)}\nJob:\n${j.text}`;
  }

  schedule() {
    if (!this.claude.exe()) return; // Claude Code missing: jobs wait in the queue
    let running = this.jobs.filter((j) => j.status === 'running').length;
    for (const j of this.jobs) {
      if (running >= this.concurrency) break;
      if (j.status !== 'queued') continue;
      let w = j.pref !== 'any' ? this.byWorker(j.pref) : null;
      if (j.pref !== 'any' && !w) j.pref = 'any';
      if (j.pref === 'any') {
        const free = this.workers.filter((x) => !this.workerBusy(x));
        if (!free.length) continue;
        free.sort((a, b) => this.busyMs(a, 3600e3) - this.busyMs(b, 3600e3));
        // Tasks from a project with a repo go to a coder when one is free.
        w = (this.repoReady(this.projectById(j.projectId)) && j.taskId && free.find((x) => x.capability === 'code')) || free[0];
      }
      if (this.workerBusy(w)) continue;
      running++;
      this.runJob(j, w);
    }
  }

  repoReady(p) { return !!(p && p.repo && p.repo.status === 'ready' && p.repo.path && this.repos); }

  jobKind(j, w) {
    if (w.capability === 'pm') return 'pm';
    if (j.qaFor && w.capability === 'qa' && this.repoReady(this.projectById(j.projectId))) return 'qa';
    if (w.capability === 'code' && this.repoReady(this.projectById(j.projectId))) return 'code';
    return 'text';
  }

  async runJob(j, w) {
    const kind = this.jobKind(j, w);
    if (kind === 'code') return this.runCodeJob(j, w);
    if (kind === 'qa') return this.runQaJob(j, w);
    j.kind = kind;
    const prompt = this.buildPrompt(j, w) + (kind === 'pm' ? PM_INSTRUCTIONS : '');
    Object.assign(j, { status: 'running', workerId: w.id, startedAt: Date.now(), output: '', inTok: tok(prompt), tierApplied: j.tier, model: this.claude.modelFor(j.tier) });
    this.jobChanged(j);
    const ctl = new AbortController();
    this.controllers.set(j.id, ctl);
    let lastEmit = 0;
    const onText = (text) => {
      if (!j.firstTokenAt) j.firstTokenAt = Date.now();
      j.output = text.slice(0, MAX_OUTPUT);
      j.outTok = tok(text);
      const now = Date.now();
      if (now - lastEmit > 120) { lastEmit = now; this.jobChanged(j, { persist: false }); }
    };
    try {
      // The specialty prompt goes in the system prompt; the full artifact-style prompt is the user turn.
      const res = await this.claude.stream({
        exe: this.claude.exe(),
        model: j.model,
        systemPrompt: `You are ${w.name}, a worker pet at Burrowby Works. ${w.specialty || ''}`.trim(),
        prompt,
        cwd: this.claude.cwd,
        signal: ctl.signal,
        onText,
        onRateLimit: () => { this.lastRateLimit = Date.now(); },
      });
      j.output = String(res.text || '').slice(0, MAX_OUTPUT);
      if (!j.firstTokenAt && j.output) j.firstTokenAt = Date.now();
      j.truncated = res.stopReason === 'max_tokens' || res.text.length > MAX_OUTPUT;
      if (res.inTok) j.inTok = res.inTok;
      j.outTok = res.outTok || tok(j.output);
      if (res.model) j.model = res.model;
      if (res.stopReason === 'refusal') { j.status = 'failed'; j.error = 'refused'; }
      else if (!j.output.trim()) { j.status = 'failed'; j.error = 'empty_completion'; }
      else j.status = 'done';
      if (j.kind === 'pm' && j.status === 'done') j.proposals = parseTickets(j.output);
    } catch (e) {
      if (e.code === 'cancelled') j.status = 'cancelled';
      else { j.status = 'failed'; j.error = e.code || 'upstream_error'; j.errorDetail = e.message; }
      if (e.code === 'rate_limited') this.lastRateLimit = Date.now();
      if (typeof e.text === 'string' && e.text) j.output = e.text.slice(0, MAX_OUTPUT);
    }
    j.finishedAt = Date.now();
    this.controllers.delete(j.id);
    this.jobChanged(j);
    this.onJobFinished(j);
    this.schedule();
  }

  onJobFinished(j) {
    const t = j.taskId && this.taskById(j.taskId);
    if (j.qaFor) this.onQaFinished(j, t);
    else if (t && j.status === 'done' && ['backlog', 'todo', 'progress'].includes(t.status)) {
      // Every coder's PR goes through QA before Review; other jobs go straight to Review.
      if (j.kind === 'code' && j.branch && this.startQa(j, t)) { /* task is now in Testing */ } else {
        Object.assign(t, { status: 'review', order: Date.now(), updatedAt: Date.now() });
        this.changed('tasks');
        this.emit('notice', { kind: 'task-review', text: `${this.taskKey(t)} is ready for review.` });
      }
    }
    if (j.kind === 'pm' && j.status === 'done' && this.autoAcceptPm !== false && Array.isArray(j.proposals) && j.proposals.length) {
      try { this.acceptProposals(j.id); } catch (e) { /* no project: leave proposals for manual accept */ }
    }
    const w = this.byWorker(j.workerId);
    if (j.status === 'done') this.emit('notice', { kind: 'job', job: j.id, byForeman: !!j.byForeman, text: `${w ? w.name : 'A worker'} finished job #${j.n}.${j.byForeman ? ' Want the summary?' : ''}` });
    else if (j.status === 'failed') this.emit('notice', { kind: 'job', job: j.id, byForeman: !!j.byForeman, text: `Job #${j.n} failed (${j.error}).${j.byForeman ? ' Want me to retry it?' : ''}` });
  }

  // ---------- QA stage ----------
  // The QA worker for a project: a free one if possible, else the least busy. Hires one if the factory has none.
  qaWorker() {
    const qa = this.workers.filter((w) => w.capability === 'qa');
    if (qa.length) return qa.find((w) => !this.workerBusy(w)) || qa[0];
    const used = new Set(this.workers.map((w) => w.name));
    const name = [...QA_NAMES, ...NAMES].find((n) => !used.has(n));
    if (!name || this.workers.length >= MAX_WORKERS) return null;
    return this.saveWorker({ id: uid('w_'), name, species: 'bunny', specialty: QA_SPECIALTY, capability: 'qa' });
  }

  // A coder's work is ready: move the task to Testing and queue a QA job for the PR branch.
  startQa(coderJob, t) {
    if (!this.repoReady(this.projectById(coderJob.projectId))) return false;
    const w = this.qaWorker();
    if (!w) return false;
    const ref = this.taskKey(t);
    const text = `Verify ${ref}: ${t.title}\n\nAcceptance criteria and description:\n${t.desc || '(none given)'}\n\nThe coder's work is on branch ${coderJob.branch}${coderJob.pr ? ` (PR #${coderJob.pr.number})` : ''}. Coder's summary:\n${String(coderJob.output || '').slice(0, 3000)}`;
    Object.assign(t, { status: 'testing', order: Date.now(), updatedAt: Date.now() });
    const ctx = [...new Set([...(this.projectById(t.projectId).ctx || []), ...(t.ctx || [])])].filter((id) => this.ctxById(id));
    const q = this.createJob(text, w.id, 'default', { ctx, taskId: t.id, projectId: t.projectId, qaFor: coderJob.id });
    t.jobs = [...(t.jobs || []), q.id];
    this.changed('tasks');
    this.emit('notice', { kind: 'task-testing', text: `${ref} is in Testing with ${w.name}.` });
    return true;
  }

  buildQaPrompt(j, ref, wt) {
    return `${j.text}\n${this.contextBlock(j.ctx)}\nYour checkout is at the PR branch; the base branch is origin/dev (see it with git diff origin/dev...HEAD). Do the following:
1. Read the diff.
2. Run the project's existing tests (for example npm test). If none exist, say so.
3. Where tests are missing for the new behavior, add them and commit them with a message that starts with "${ref}:".
4. Check each acceptance criterion above and say whether it is met.
Reply with short QA notes: what you ran, what passed, what failed and why. Make the very last line exactly "VERDICT: PASS" if the work meets the acceptance criteria and all tests pass, otherwise "VERDICT: FAIL".`;
  }

  async runQaJob(j, w) {
    const p = this.projectById(j.projectId);
    const t = j.taskId ? this.taskById(j.taskId) : null;
    const origin = this.jobById(j.qaFor);
    const ref = t ? this.taskKey(t) : `${p.key} job #${j.n}`;
    Object.assign(j, { kind: 'qa', status: 'running', workerId: w.id, startedAt: Date.now(), output: '', steps: [], tierApplied: j.tier, model: this.claude.modelFor(j.tier), branch: origin && origin.branch, pr: origin && origin.pr, diff: null });
    this.jobChanged(j);
    const ctl = new AbortController();
    this.controllers.set(j.id, ctl);
    const step = (label) => { j.steps = [...(j.steps || []), redact(label)].slice(-200); this.jobChanged(j, { persist: false }); };
    let wt = null;
    let ready = false; // auto-merge: checks passed in QA's worktree, merge after cleanup
    let end = { status: 'failed', error: 'upstream_error' };
    try {
      if (!j.branch) throw Object.assign(new Error('The coder job has no branch to test.'), { code: 'no_branch' });
      wt = await this.repos.createReviewWorktree(p.key, j.branch);
      j.worktree = wt.dir;
      step(`Checked out ${j.branch} for testing`);
      let lastEmit = 0;
      const res = await this.claude.stream({
        exe: this.claude.exe(),
        model: j.model,
        systemPrompt: qaSystemPrompt(w, ref),
        prompt: this.buildQaPrompt(j, ref, wt),
        cwd: wt.dir,
        signal: ctl.signal,
        onText: (text) => {
          if (!j.firstTokenAt) j.firstTokenAt = Date.now();
          j.output = redact(text).slice(0, MAX_OUTPUT);
          const now = Date.now();
          if (now - lastEmit > 150) { lastEmit = now; this.jobChanged(j, { persist: false }); }
        },
        onRateLimit: () => { this.lastRateLimit = Date.now(); },
        code: { tools: CODE_TOOLS, allowedTools: CODE_ALLOWED, disallowedTools: CODE_DENIED, maxTurns: CODE_MAX_TURNS, timeoutMs: CODE_TIMEOUT_MS, env: workerEnv(), onStep: step },
      });
      if (!j.firstTokenAt) j.firstTokenAt = Date.now();
      j.output = redact(res.text || j.output || '').slice(0, MAX_OUTPUT);
      j.outTok = res.outTok || tok(j.output);
      if (res.inTok) j.inTok = res.inTok;
      const q = parseQa(j.output);
      j.qa = { verdict: q.verdict, notes: q.notes.slice(0, 6000) };
      const fin = await this.repos.finishWorktree(wt.dir, wt.base, `${ref}: QA tests`);
      if (fin.commits) {
        j.diff = { commits: fin.commits, files: fin.files.slice(0, 100), insertions: fin.insertions, deletions: fin.deletions };
        // Tests QA added join the PR only when the work passes.
        if (q.verdict === 'pass') { step(`Adding ${fin.commits} QA test commit(s) to ${j.branch}`); await this.repos.pushHead(wt.dir, j.branch); }
      }
      // QA passed: the PR (now with QA's tests) goes through the project's auto-merge step.
      if (q.verdict === 'pass' && j.pr && p.autoMerge !== false) ready = await this.prepareAutoMerge(j, p, wt, ref, step);
      end = q.verdict ? { status: 'done' } : { status: 'failed', error: 'no_verdict' };
    } catch (e) {
      if (ctl.signal.aborted || e.code === 'cancelled') end = { status: 'cancelled' };
      else end = { status: 'failed', error: typeof e.code === 'string' && /^[a-z_]+$/.test(e.code) ? e.code : 'upstream_error', errorDetail: redact(e.message) };
      if (typeof e.text === 'string' && e.text) j.output = redact(e.text).slice(0, MAX_OUTPUT);
    }
    // Clean up before the status flips, so anyone watching a finished job sees a settled board.
    if (wt) { await this.repos.removeWorktree(p.key, wt.dir).catch(() => {}); j.worktree = null; }
    if (ready && end.status === 'done') await this.finishAutoMerge(j, p, t, ref, step);
    Object.assign(j, end);
    j.finishedAt = Date.now();
    this.controllers.delete(j.id);
    this.jobChanged(j);
    this.onJobFinished(j);
    this.schedule();
  }

  // QA is done: fail -> back to In progress for the original coder; pass -> Done if auto-merge merged
  // the PR (finishAutoMerge already moved the task), otherwise Review. Notes stay on the task.
  onQaFinished(j, t) {
    if (!t) return;
    const w = this.byWorker(j.workerId);
    const coderJob = this.jobById(j.qaFor);
    const coder = coderJob && this.byWorker(coderJob.workerId);
    const verdict = j.status === 'done' && j.qa && j.qa.verdict ? j.qa.verdict : 'error';
    const notes = verdict === 'error'
      ? `QA could not finish (${j.status === 'cancelled' ? 'stopped' : j.error || 'no result'}). Passing to Review so a person can look.${j.output ? `\n\n${j.qa ? j.qa.notes : String(j.output).slice(0, 3000)}` : ''}`
      : j.qa.notes;
    t.qa = [...(t.qa || []), { job: j.id, n: j.n, verdict, notes, by: w ? w.name : 'QA', coder: coder ? coder.name : '', at: Date.now() }].slice(-MAX_QA_NOTES);
    if (t.status === 'testing') { // a person may have moved the task meanwhile; leave it where they put it
      if (verdict === 'fail') Object.assign(t, { status: 'progress', assignee: coder ? coder.id : t.assignee });
      else t.status = 'review';
      t.order = Date.now();
    }
    t.updatedAt = Date.now();
    this.changed('tasks');
    const key = this.taskKey(t);
    if (j.merge && j.merge.status === 'merged') return; // finishAutoMerge already announced it
    this.emit('notice', verdict === 'fail'
      ? { kind: 'task-qa-fail', text: `${key} failed QA and is back in In progress${coder ? ` for ${coder.name}` : ''}.` }
      : { kind: 'task-review', text: `${key} ${verdict === 'pass' ? 'passed QA and ' : ''}is ready for review.` });
  }

  stopJob(id) {
    const j = this.jobById(id);
    if (!j || !this.isActive(j)) return j || null;
    if (j.status === 'queued') {
      Object.assign(j, { status: 'cancelled', finishedAt: Date.now() });
      this.jobChanged(j);
    } else this.controllers.get(j.id)?.abort();
    return j;
  }

  stopAll() {
    const active = this.jobs.filter((j) => this.isActive(j));
    for (const j of active) this.stopJob(j.id);
    return active.length;
  }

  // ---------- coding jobs ----------
  async runCodeJob(j, w) {
    const p = this.projectById(j.projectId);
    const t = j.taskId ? this.taskById(j.taskId) : null;
    const key = p.key;
    const ref = t ? `${key}-${t.n}` : `${key} job #${j.n}`;
    Object.assign(j, { kind: 'code', status: 'running', workerId: w.id, startedAt: Date.now(), output: '', steps: [], tierApplied: j.tier, model: this.claude.modelFor(j.tier), pr: null, prError: null, diff: null });
    this.jobChanged(j);
    const ctl = new AbortController();
    this.controllers.set(j.id, ctl);
    const step = (label) => { j.steps = [...(j.steps || []), redact(label)].slice(-200); this.jobChanged(j, { persist: false }); };
    let wt = null;
    try {
      wt = await this.repos.createWorktree(key, t ? t.n : `job${j.n}`, t ? t.title : j.text.split('\n')[0]);
      Object.assign(j, { branch: wt.branch, worktree: wt.dir });
      step(`Created worktree on ${wt.branch} (from dev)`);
      if (ctl.signal.aborted) throw Object.assign(new Error('Stopped.'), { code: 'cancelled' });
      const prompt = this.buildCodePrompt(j, w, ref, wt);
      j.inTok = tok(prompt);
      let lastEmit = 0;
      const res = await this.claude.stream({
        exe: this.claude.exe(),
        model: j.model,
        systemPrompt: codeSystemPrompt(w, ref, wt),
        prompt,
        cwd: wt.dir,
        signal: ctl.signal,
        onText: (text) => {
          if (!j.firstTokenAt) j.firstTokenAt = Date.now();
          j.output = redact(text).slice(0, MAX_OUTPUT);
          const now = Date.now();
          if (now - lastEmit > 150) { lastEmit = now; this.jobChanged(j, { persist: false }); }
        },
        onRateLimit: () => { this.lastRateLimit = Date.now(); },
        code: { tools: CODE_TOOLS, allowedTools: CODE_ALLOWED, disallowedTools: CODE_DENIED, maxTurns: CODE_MAX_TURNS, timeoutMs: CODE_TIMEOUT_MS, env: workerEnv(), onStep: step },
      });
      if (!j.firstTokenAt) j.firstTokenAt = Date.now();
      j.output = redact(res.text || j.output || '').slice(0, MAX_OUTPUT);
      j.outTok = res.outTok || tok(j.output);
      if (res.inTok) j.inTok = res.inTok;
      if (res.maxTurns) step(`Stopped at the ${CODE_MAX_TURNS}-turn limit`);
      // The app, not the agent, commits leftovers, pushes and opens the PR.
      const fin = await this.repos.finishWorktree(wt.dir, wt.base, `${ref}: ${t ? t.title : 'factory job'}`);
      if (fin.autoCommitted) step('Committed leftover changes the worker had not committed');
      j.diff = { commits: fin.commits, files: fin.files.slice(0, 100), insertions: fin.insertions, deletions: fin.deletions };
      if (!fin.commits) {
        j.status = 'failed';
        j.error = 'no_changes';
      } else {
        step(`Pushing ${wt.branch}`);
        await this.repos.push(key, wt.branch);
        if (p.repo.github) {
          try {
            const body = `${t ? `Task **${ref}**: ${t.title}\n\n${t.desc || ''}` : j.text}\n\n---\nOpened by Burrowby Works for ${w.name} (job #${j.n}). ${fin.files.length} file(s) changed, +${fin.insertions} -${fin.deletions}.`;
            j.pr = await this.repos.openPr(key, wt.branch, `${ref}: ${t ? t.title : j.text.split('\n')[0].slice(0, 70)}`, body);
            step(`Opened PR #${j.pr.number} into dev`);
          } catch (e) {
            j.prError = redact(e.message);
            step(`Could not open a PR: ${j.prError}`);
          }
        } else {
          j.prError = 'The project remote is not on GitHub, so no PR was opened. The branch was pushed.';
        }
        // Auto-merge (per project, on by default): test the merge with dev in the
        // worktree, then let the app merge the PR into dev. Never touches prod.
        const qaNext = this.qaWillRun(t, p);
        if (qaNext && j.pr) step(`Handing over to QA${p.autoMerge !== false ? '; auto-merge runs after QA passes' : ''}`);
        const ready = j.pr && p.autoMerge !== false && !qaNext ? await this.prepareAutoMerge(j, p, wt, ref, step) : false;
        await this.repos.removeWorktree(key, wt.dir).catch(() => {});
        j.worktree = null;
        if (ready) await this.finishAutoMerge(j, p, t, ref, step);
        j.status = 'done';
      }
    } catch (e) {
      if (ctl.signal.aborted || e.code === 'cancelled') j.status = 'cancelled';
      else { j.status = 'failed'; j.error = typeof e.code === 'string' && /^[a-z_]+$/.test(e.code) ? e.code : 'upstream_error'; j.errorDetail = redact(e.message); }
      if (typeof e.text === 'string' && e.text) j.output = redact(e.text).slice(0, MAX_OUTPUT);
    }
    j.finishedAt = Date.now();
    this.controllers.delete(j.id);
    this.jobChanged(j);
    this.onJobFinished(j);
    this.schedule();
  }

  // Mirrors onJobFinished + startQa: a coder's task-bound PR goes to QA when a QA worker exists or can be hired.
  qaWillRun(t, p) {
    return !!(t && ['backlog', 'todo', 'progress'].includes(t.status) && this.repoReady(p)
      && (this.workers.some((w) => w.capability === 'qa') || this.workers.length < MAX_WORKERS));
  }

  blockMerge(j, ref, reason, step, extra = {}) {
    j.merge = { status: 'blocked', reason, at: Date.now(), ...extra };
    step(`Left PR #${j.pr.number} open: ${reason}`);
    this.emit('notice', { kind: 'job', job: j.id, text: `PR #${j.pr.number} for ${ref} needs you: ${reason}.` });
    return false;
  }

  // Returns true when the PR is ready to merge: no conflict with dev, checks pass.
  async prepareAutoMerge(j, p, wt, ref, step) {
    try {
      step('Auto-merge: merging the latest dev into the worktree to test the result');
      const m = await this.repos.mergeDevInto(wt.dir);
      if (m.conflict) return this.blockMerge(j, ref, `conflicts with dev${m.files.length ? ` in ${m.files.slice(0, 5).join(', ')}` : ''}`, step);
      const cmd = (p.checkCmd || '').trim() || this.repos.detectCheck(wt.dir);
      if (!cmd) return this.blockMerge(j, ref, 'no check command (set one in the project settings)', step);
      step(`Running checks: ${cmd}`);
      const check = await this.repos.runCheck(wt.dir, cmd, workerEnv());
      const summary = { cmd, ok: check.ok, exitCode: check.exitCode, ms: check.ms, output: check.output };
      if (!check.ok) return this.blockMerge(j, ref, `checks failed (${cmd}${check.timedOut ? ', timed out' : `, exit ${check.exitCode}`})`, step, { check: summary });
      step(`Checks passed: ${cmd} (${fmtDur(check.ms)})`);
      j.merge = { status: 'checking', check: summary };
      return true;
    } catch (e) {
      return this.blockMerge(j, ref, `could not test the merge: ${redact(e.message)}`, step);
    }
  }

  async finishAutoMerge(j, p, t, ref, step) {
    const check = j.merge && j.merge.check;
    try {
      const info = await this.repos.waitMergeable(p.key, j.pr.number);
      if (!info || info.mergeable !== 'MERGEABLE') {
        return this.blockMerge(j, ref, info && info.mergeable === 'CONFLICTING' ? 'GitHub reports a conflict with dev' : `GitHub says it isn't mergeable yet (${(info && (info.mergeStateStatus || info.mergeable)) || 'unknown'})`, step, { check });
      }
      await this.repos.mergePr(p.key, j.pr.number);
      j.pr = { ...j.pr, merged: true };
      j.merge = { status: 'merged', at: Date.now(), check };
      for (const x of this.jobs) if (x !== j && x.pr && x.pr.number === j.pr.number && x.projectId === j.projectId) { x.pr = { ...x.pr, merged: true }; this.jobChanged(x); }
      step(`Merged PR #${j.pr.number} into dev`);
      // Merged into dev with checks passing: the task is done. The owner's gate is
      // Release to prod, which lists exactly the PRs it will ship.
      const cur = t && this.taskById(t.id); // t may be stale if a window saved the task meanwhile
      if (cur) { Object.assign(cur, { status: 'done', order: Date.now() }); this.upsert('tasks', cur); }
      this.emit('notice', { kind: 'job', job: j.id, text: `${ref}: checks passed and PR #${j.pr.number} is merged into dev.` });
    } catch (e) {
      this.blockMerge(j, ref, `merge failed: ${redact(e.message)}`, step, { check });
    }
  }

  buildCodePrompt(j, w, ref, wt) {
    return `Task ${ref}\n\n${j.text}\n${this.contextBlock(j.ctx)}\nYou are in a git worktree of the project on branch ${wt.branch}, cut from dev. Make the change, run the project's tests if it has any, and commit your work with a message that starts with "${ref}:". When you are done, reply with a short summary of what you changed and anything left to do.`;
  }

  // ---------- project repositories ----------
  async setProjectRepo(projectRef, source) {
    if (!this.repos) throw new Error('Repositories are not available in this build.');
    const p = this.findProject(projectRef) || this.projectById(projectRef);
    if (!p) throw new Error('No such project.');
    source = String(source || '').trim();
    p.repo = { ...(p.repo || {}), source: redact(source || (p.repo && p.repo.source) || ''), status: 'setting-up', error: '' };
    this.changed('projects');
    try {
      const r = await this.repos.setup(p.key, source || null);
      p.repo = { source: redact(source || p.repo.source), path: r.path, url: r.url, github: r.github, status: 'ready', error: '' };
      this.changed('projects');
      this.schedule();
      return { project: p.key, folder: r.path, remote: r.url, github: r.github, created_branches: r.created };
    } catch (e) {
      p.repo = { ...p.repo, status: 'error', error: redact(e.message) };
      this.changed('projects');
      throw e;
    }
  }

  repoProject(projectRef) {
    const p = this.findProject(projectRef) || this.projectById(projectRef);
    if (!p) throw new Error('No such project.');
    if (!this.repoReady(p)) throw new Error(`Project ${p.key} has no repository set up.`);
    return p;
  }
  async listPrs(projectRef) { const p = this.repoProject(projectRef); return this.repos.listPrs(p.key); }
  async mergePr(projectRef, number) {
    const p = this.repoProject(projectRef);
    const r = await this.repos.mergePr(p.key, number);
    for (const j of this.jobs) if (j.pr && j.pr.number === Number(number) && j.projectId === p.id) { j.pr = { ...j.pr, merged: true }; this.jobChanged(j); }
    return r;
  }
  async releasePreview(projectRef) { const p = this.repoProject(projectRef); return this.repos.releasePreview(p.key); }
  // Owner-only (the Board's button): fast-forward prod to the previewed dev commit.
  async releaseToProd(projectRef, sha) {
    const p = this.repoProject(projectRef);
    const preview = await this.repos.releasePreview(p.key);
    if (preview.diverged) throw new Error(preview.summary);
    if (!preview.ahead) return { released: false, note: preview.summary, preview };
    const r = await this.repos.release(p.key, sha || preview.devSha);
    if (r.released) {
      p.lastRelease = { sha: r.sha, from: r.from, commits: r.commits, prs: preview.prs, at: Date.now() };
      this.changed('projects');
    }
    return { ...r, prs: preview.prs };
  }

  // ---------- PM proposals ----------
  acceptProposals(jobRef, picks) {
    const j = this.jobById(jobRef) || this.jobByN(jobRef);
    if (!j || !Array.isArray(j.proposals) || !j.proposals.length) throw new Error('That job has no proposed tickets.');
    const p = this.projectById(j.projectId) || (j.taskId && this.projectById((this.taskById(j.taskId) || {}).projectId));
    if (!p) throw new Error('That job is not linked to a project, so its tickets have nowhere to go.');
    const want = Array.isArray(picks) && picks.length ? new Set(picks.map(Number)) : null;
    const added = [];
    const norm = (s) => String(s || '').trim().toLowerCase();
    const titles = new Set(this.tasks.filter((t) => t.projectId === p.id).map((t) => norm(t.title)));
    j.proposals = j.proposals.map((x, i) => {
      if (x.accepted || (want && !want.has(i))) return x;
      if (titles.has(norm(x.title))) return x; // duplicate of a ticket already on the board
      titles.add(norm(x.title));
      const note = `Created by job #${j.n}.`;
      const t = this.makeTask(this.projectById(p.id), { title: x.title, desc: x.desc ? `${x.desc}\n\n${note}` : note, priority: x.priority, status: 'backlog', labels: ['proposed'] });
      added.push(this.taskKey(t));
      return { ...x, accepted: this.taskKey(t) };
    });
    this.jobChanged(j);
    return added;
  }

  retryJob(id) {
    const j = this.jobById(id);
    if (!j) return null;
    return this.createJob(j.text, j.workerId && this.byWorker(j.workerId) ? j.workerId : 'any', j.tier, { ctx: j.ctx, projectId: j.projectId });
  }

  deleteJobs(ids) {
    const gone = new Set(ids.filter((id) => { const j = this.jobById(id); return j && !this.isActive(j); }));
    if (!gone.size) return 0;
    this.jobs = this.jobs.filter((j) => !gone.has(j.id));
    this.save();
    this.emitPatch({ removedJobs: [...gone] });
    return gone.size;
  }
  clearFinished() { return this.deleteJobs(this.jobs.filter((j) => !this.isActive(j)).map((j) => j.id)); }

  // ---------- factory ----------
  setConcurrency(c) {
    if (![1, 2, 3].includes(c)) return;
    this.concurrency = c;
    this.changed('factory');
    this.schedule();
  }
  // Whole-factory save from the main window (worker edits, hires, jobs at once, foreman).
  setFactory(f) {
    if (Array.isArray(f.workers) && f.workers.length) this.workers = f.workers.filter((w) => w && w.id && w.name).slice(0, MAX_WORKERS).map(normWorker);
    if ([1, 2, 3].includes(f.concurrency)) this.concurrency = f.concurrency;
    if (f.foreman) this.foreman = normForeman(f.foreman);
    if (typeof f.autoAcceptPm === 'boolean') this.autoAcceptPm = f.autoAcceptPm;
    this.changed('factory');
    this.schedule();
    return this.factoryDoc();
  }
  saveWorker(w) {
    const nw = normWorker(w);
    const cur = this.byWorker(nw.id);
    if (cur) Object.assign(cur, nw);
    else if (this.workers.length < MAX_WORKERS) this.workers.push(nw);
    this.changed('factory');
    this.schedule();
    return nw;
  }
  hireWorker() {
    if (this.workers.length >= MAX_WORKERS) return null;
    const used = new Set(this.workers.map((w) => w.name));
    const free = NAMES.filter((n) => !used.has(n));
    const w = { id: uid('w_'), name: free[Math.floor(Math.random() * free.length)] || 'Newbie', species: SPECIES[Math.floor(Math.random() * SPECIES.length)], specialty: 'Generalist. Handles any job carefully and concisely.' };
    return this.saveWorker(w);
  }
  retireWorker(id) {
    const w = this.byWorker(id);
    if (!w) return { ok: false, error: 'No such worker.' };
    if (this.workerBusy(w)) return { ok: false, error: `${w.name} is mid-job. Wait until they're back at their bench.` };
    if (this.workers.length <= 1) return { ok: false, error: 'The factory needs at least one worker.' };
    for (const j of this.jobs) if (j.status === 'queued' && j.pref === w.id) { j.pref = 'any'; this.jobChanged(j); }
    this.workers = this.workers.filter((x) => x !== w);
    this.changed('factory');
    this.schedule();
    return { ok: true };
  }
  setForeman(f) {
    this.foreman = normForeman({ ...this.foreman, ...f });
    this.changed('factory');
    return this.foreman;
  }

  // ---------- projects, tasks, context ----------
  upsert(coll, obj) {
    const norm = { projects: normProject, tasks: normTask, contexts: normCtx }[coll];
    if (!norm) throw new Error(`Unknown collection ${coll}`);
    const o = norm({ ...obj, updatedAt: Date.now() });
    const list = this[coll];
    const i = list.findIndex((x) => x.id === o.id);
    // Repo settings change only through setProjectRepo, never through a plain save.
    if (coll === 'projects') { o.repo = i >= 0 ? list[i].repo : null; o.lastRelease = i >= 0 ? list[i].lastRelease : null; }
    if (i >= 0) list[i] = o;
    else list.push(o);
    this.changed(coll);
    return o;
  }
  remove(coll, id) {
    if (!['projects', 'tasks', 'contexts'].includes(coll)) return;
    this[coll] = this[coll].filter((x) => x.id !== id);
    this.changed(coll);
  }
  makeProject(o) {
    return this.upsert('projects', { id: uid('p_'), name: o.name, key: o.key, color: o.color || COLORS[this.projects.length % COLORS.length], desc: o.desc || '', ctx: o.ctx || [], seq: 0, createdAt: Date.now() });
  }
  makeTask(p, o) {
    p.seq = Math.max(p.seq || 0, ...this.tasks.filter((t) => t.projectId === p.id).map((t) => t.n || 0)) + 1;
    this.upsert('projects', p);
    return this.upsert('tasks', { id: uid('t_'), projectId: p.id, n: p.seq, title: o.title, desc: o.desc || '', status: o.status || 'todo', priority: o.priority || 'med', assignee: o.assignee || '', labels: o.labels || [], due: o.due || '', ctx: o.ctx || [], jobs: [], order: Date.now() + Math.random(), createdAt: Date.now() });
  }
  sendTask(taskId, extra = {}) {
    const t = this.taskById(taskId);
    if (!t) return null;
    const p = this.projectById(t.projectId);
    const ctx = [...new Set([...(p ? p.ctx || [] : []), ...(t.ctx || [])])].filter((id) => this.ctxById(id));
    const lastQa = (t.qa || [])[(t.qa || []).length - 1];
    const text = `${t.title}${t.desc ? '\n\n' + t.desc : ''}${lastQa && lastQa.verdict === 'fail' ? `\n\nQA failed the previous attempt. Fix these problems:\n${lastQa.notes}` : ''}`;
    const j = this.createJob(text, t.assignee && this.byWorker(t.assignee) ? t.assignee : 'any', 'default', { ctx, taskId: t.id, projectId: t.projectId, ...extra });
    Object.assign(t, { jobs: [...(t.jobs || []), j.id], status: 'progress', order: Date.now() });
    this.upsert('tasks', t);
    return j;
  }
  sampleProject() {
    const now = Date.now();
    const voice = this.upsert('contexts', { id: uid('c_'), title: 'Blog voice guide', kind: 'style', tags: ['sample', 'writing'], content: 'Sample entry.\n\nWrite warmly and plainly, like a friendly neighbor who knows their stuff.\n- Short sentences. Active voice.\n- No jargon unless the reader would use it.\n- One idea per paragraph.\n- End with something the reader can do next.', createdAt: now });
    const facts = this.upsert('contexts', { id: uid('c_'), title: 'Blog facts', kind: 'data', tags: ['sample'], content: 'Sample entry.\n\nBlog name: The Burrow\nAudience: small-team founders and indie developers\nCadence: one post per week\nHosting budget: under $20 per month\nStack: static site, Markdown posts in /posts', createdAt: now + 1 });
    const p = this.makeProject({ name: 'Launch the company blog', key: 'BLOG', color: COLORS[1], desc: 'Sample project. Plan, write and ship a small weekly blog for founders and indie developers.', ctx: [voice.id, facts.id] });
    const find = (re) => (this.workers.find((w) => re.test(w.specialty || '')) || {}).id || '';
    [['Pick five launch post topics', 'List five post ideas with a one-line angle each. Favor practical, experience-based topics.', 'todo', 'high', find(/research/i), ['planning']],
      ['Draft the welcome post', 'Write a 300-word welcome post that says who the blog is for and what to expect each week.', 'todo', 'med', find(/writ/i), ['copy']],
      ['Write an RSS feed generator', 'Python script that reads Markdown posts from a folder and writes a valid RSS 2.0 feed.', 'backlog', 'med', find(/cod/i), ['code']],
      ['Estimate monthly hosting cost', 'Compare three static hosts for about 5,000 monthly visitors and recommend one under budget.', 'backlog', 'low', find(/analy/i), ['research']],
      ['Write newsletter signup copy', 'Headline, one-line pitch and button text for a signup box, in three variations.', 'backlog', 'med', find(/writ/i), ['copy']],
    ].forEach(([title, desc, status, priority, assignee, labels]) => this.makeTask(this.projectById(p.id), { title, desc, status, priority, assignee, labels }));
    return p;
  }

  async suggestTasks(projectId) {
    const p = this.projectById(projectId);
    if (!p) throw new Error('No such project.');
    const existing = this.tasks.filter((t) => t.projectId === p.id).map((t) => `- ${t.title} (${t.status})`).join('\n') || '(none yet)';
    const prompt = `You help plan projects that will be carried out by AI workers (a researcher, a coder, a writer and an analyst). Suggest 6 concrete, non-overlapping next tasks for this project. Each must be doable by one worker in one sitting and produce a written result (research notes, code, copy, or analysis).\n\nProject: ${p.name}\nDescription: ${p.desc || '(none)'}\n${this.contextBlock(p.ctx, 6000)}\nExisting tasks:\n${existing}`;
    const schema = {
      type: 'object',
      properties: { tasks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: Object.keys(PRIO) } }, required: ['title', 'description', 'priority'] } } },
      required: ['tasks'],
    };
    const res = await this.claude.run({ exe: this.claude.exe(), model: this.claude.modelFor('default'), effort: 'low', systemPrompt: 'You plan projects. Reply only through the structured output.', jsonSchema: schema, prompt, cwd: this.claude.cwd });
    const arr = (res.structured && res.structured.tasks) || [];
    return arr.filter((x) => x && x.title).slice(0, 8).map((x) => ({ title: String(x.title).slice(0, 140), desc: String(x.description || ''), priority: PRIO[x.priority] ? x.priority : 'med', pick: true }));
  }

  // ---------- foreman ----------
  workerStatus(w) {
    const j = this.jobs.find((x) => x.status === 'running' && x.workerId === w.id);
    return j ? (j.firstTokenAt ? 'writing' : 'thinking') : 'idle';
  }

  tools() {
    const E = this;
    return {
      get_factory_status() {
        return {
          jobs_at_once: E.concurrency,
          workers: E.workers.map((w) => {
            const j = E.jobs.find((x) => x.status === 'running' && x.workerId === w.id);
            const fin = E.jobs.filter((x) => x.workerId === w.id && (x.status === 'done' || x.status === 'failed'));
            return { name: w.name, capability: w.capability, species: w.species, specialty: (w.specialty || '').slice(0, 160), status: E.workerStatus(w), current_job: j ? j.n : null, queued_for_them: E.jobs.filter((q) => q.status === 'queued' && q.pref === w.id).length, shipped: fin.filter((x) => x.status === 'done').length, failed: fin.filter((x) => x.status === 'failed').length };
          }),
          queue: E.jobs.filter((j) => j.status === 'queued').map((j) => ({ job: j.n, worker: (E.byWorker(j.pref) || {}).name || 'any', text: j.text.slice(0, 80) })),
          recent_jobs: E.jobs.slice(-10).reverse().map((j) => ({ job: j.n, status: STATUS_LABEL[j.status], worker: (E.byWorker(j.workerId || j.pref) || {}).name || 'any', task: j.taskId && E.taskById(j.taskId) ? E.taskKey(E.taskById(j.taskId)) : null, text: j.text.slice(0, 80), run_time: j.startedAt ? fmtDur(E.runMs(j)) : null })),
        };
      },
      assign_job(i, msg) {
        const text = String(i.text || '').trim();
        if (!text) throw new Error('text is required');
        let pref = 'any';
        if (i.worker && String(i.worker).toLowerCase() !== 'any') {
          const w = E.findWorker(i.worker);
          if (!w) throw new Error(`No worker named ${i.worker}. Workers: ${E.workers.map((w) => w.name).join(', ')}`);
          pref = w.id;
        }
        const tier = ['quick', 'default', 'complex'].includes(i.model) ? i.model : 'default';
        const p = i.project ? E.findProject(i.project) : null;
        const j = E.createJob(text, pref, tier, { byForeman: true, ...(p ? { projectId: p.id, ctx: (p.ctx || []).filter((id) => E.ctxById(id)) } : {}) });
        const who = pref === 'any' ? 'the next free worker' : E.byWorker(pref).name;
        msg.actions.push(`Job #${j.n} → ${who}`);
        return { job: j.n, assigned_to: who, status: 'queued' };
      },
      get_job(i) {
        const j = E.jobByN(i.job);
        if (!j) throw new Error(`No job #${i.job}`);
        return { job: j.n, kind: j.kind || 'text', auto_merge: j.merge ? { status: j.merge.status, reason: j.merge.reason || null } : null, status: STATUS_LABEL[j.status], worker: (E.byWorker(j.workerId || j.pref) || {}).name || 'any', text: j.text.slice(0, 300), run_time: j.startedAt ? fmtDur(E.runMs(j)) : null, error: j.error || null, branch: j.branch || null, pr: j.pr ? j.pr.url : null, pr_error: j.prError || null, diff: j.diff ? { files: j.diff.files.length, insertions: j.diff.insertions, deletions: j.diff.deletions } : null, proposed_tickets: j.proposals || null, output: (j.output || '').slice(0, 4000) || null };
      },
      stop_job(i, msg) {
        const j = E.jobByN(i.job);
        if (!j) throw new Error(`No job #${i.job}`);
        if (!E.isActive(j)) return { job: j.n, status: STATUS_LABEL[j.status], note: 'It was not running.' };
        E.stopJob(j.id);
        msg.actions.push(`Stopped job #${j.n}`);
        return { job: j.n, stopped: true };
      },
      list_projects() {
        return E.projects.map((p) => ({ key: p.key, name: p.name, description: (p.desc || '').slice(0, 200), repo: p.repo ? { status: p.repo.status, remote: p.repo.url, github: p.repo.github, error: p.repo.error || null, auto_merge: p.autoMerge, check_command: p.checkCmd || 'auto-detected' } : null, tasks: Object.fromEntries(COLS.map(([k, l]) => [l, E.tasks.filter((t) => t.projectId === p.id && t.status === k).length])) }));
      },
      list_tasks(i) {
        const p = E.findProject(i.project);
        if (!p) throw new Error('No such project. Use a key from list_projects.');
        return E.tasks.filter((t) => t.projectId === p.id && (!i.status || t.status === i.status)).map((t) => ({ key: E.taskKey(t), title: t.title, status: t.status, priority: t.priority, assignee: (E.byWorker(t.assignee) || {}).name || 'any', last_job: (E.lastJob(t) || {}).n || null }));
      },
      create_project(i, msg) {
        const name = String(i.name || '').trim().slice(0, 60);
        if (!name) throw new Error('name is required');
        const key = String(i.key || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || keyFrom(name);
        if (E.projects.some((p) => p.key === key)) throw new Error(`Key ${key} is taken. Pick another key.`);
        const p = E.makeProject({ name, key, desc: String(i.description || '').slice(0, 2000) });
        msg.actions.push(`Project ${p.key} created`);
        return { key: p.key, name: p.name };
      },
      create_task(i, msg) {
        const p = E.findProject(i.project);
        if (!p) throw new Error('No such project. Use a key from list_projects, or create_project first.');
        const title = String(i.title || '').trim().slice(0, 140);
        if (!title) throw new Error('title is required');
        const w = i.assignee ? E.findWorker(i.assignee) : null;
        const t = E.makeTask(p, { title, desc: String(i.description || '').slice(0, 6000), priority: PRIO[i.priority] ? i.priority : 'med', status: COLS.some((c) => c[0] === i.status) ? i.status : 'todo', assignee: w ? w.id : '' });
        msg.actions.push(`${E.taskKey(t)} created`);
        return { key: E.taskKey(t) };
      },
      update_task(i, msg) {
        const t = E.findTask(i.task);
        if (!t) throw new Error(`No task ${i.task}`);
        if (i.title) t.title = String(i.title).slice(0, 140);
        if (i.description != null) t.desc = String(i.description).slice(0, 6000);
        if (COLS.some((c) => c[0] === i.status) && i.status !== t.status) { t.status = i.status; t.order = Date.now(); }
        if (PRIO[i.priority]) t.priority = i.priority;
        if (i.assignee != null) { const w = E.findWorker(i.assignee); t.assignee = w ? w.id : ''; }
        E.upsert('tasks', t);
        msg.actions.push(`${E.taskKey(t)} updated`);
        return { key: E.taskKey(t), status: t.status, priority: t.priority, assignee: (E.byWorker(t.assignee) || {}).name || 'any' };
      },
      send_task_to_factory(i, msg) {
        const t = E.findTask(i.task);
        if (!t) throw new Error(`No task ${i.task}`);
        const j = E.sendTask(t.id, { byForeman: true });
        msg.actions.push(`${E.taskKey(t)} → job #${j.n}`);
        return { task: E.taskKey(t), job: j.n };
      },
      hire_worker(i, msg) {
        const w = E.hireWorker();
        if (!w) throw new Error('The factory is full (12 workers).');
        const patch = {};
        if (i.name) patch.name = String(i.name).slice(0, 20);
        if (SPECIES.includes(i.species)) patch.species = i.species;
        if (i.specialty) patch.specialty = String(i.specialty).slice(0, 1200);
        if (CAPABILITIES.includes(i.capability)) patch.capability = i.capability;
        const saved = E.saveWorker({ ...w, ...patch });
        msg.actions.push(`Hired ${saved.name} (${saved.capability})`);
        return saved;
      },
      update_worker(i, msg) {
        const w = E.findWorker(i.worker);
        if (!w) throw new Error(`No worker named ${i.worker}. Workers: ${E.workers.map((w) => w.name).join(', ')}`);
        const patch = {};
        if (i.name) patch.name = String(i.name).slice(0, 20);
        if (SPECIES.includes(i.species)) patch.species = i.species;
        if (i.specialty != null && i.specialty !== '') patch.specialty = String(i.specialty).slice(0, 1200);
        if (CAPABILITIES.includes(i.capability)) patch.capability = i.capability;
        const saved = E.saveWorker({ ...w, ...patch });
        msg.actions.push(`Updated ${saved.name}`);
        return saved;
      },
      retire_worker(i, msg) {
        const w = E.findWorker(i.worker);
        if (!w) throw new Error(`No worker named ${i.worker}.`);
        const r = E.retireWorker(w.id);
        if (!r.ok) throw new Error(r.error);
        msg.actions.push(`Retired ${w.name}`);
        return { retired: w.name };
      },
      set_jobs_at_once(i, msg) {
        const n = Number(i.n);
        if (![1, 2, 3].includes(n)) throw new Error('n must be 1, 2 or 3.');
        E.setConcurrency(n);
        msg.actions.push(`Jobs at once: ${n}`);
        return { jobs_at_once: n };
      },
      async set_project_repo(i, msg) {
        const r = await E.setProjectRepo(i.project, i.source || i.url || i.path);
        msg.actions.push(`${r.project} repo ready`);
        return r;
      },
      async list_prs(i) {
        return (await E.listPrs(i.project)).map((x) => ({ number: x.number, title: x.title, into: x.baseRefName, from: x.headRefName, url: x.url, draft: x.isDraft }));
      },
      async merge_pr(i, msg) {
        const r = await E.mergePr(i.project, i.pr);
        msg.actions.push(`Merged PR #${r.number} into dev`);
        return r;
      },
      accept_tickets(i, msg) {
        const added = E.acceptProposals(i.job, i.picks);
        msg.actions.push(added.length ? `Backlog: ${added.join(', ')}` : 'No new tickets');
        return { added };
      },
      stop_all_jobs(i, msg) {
        const n = E.stopAll();
        msg.actions.push(`Stopped ${n} job${n === 1 ? '' : 's'}`);
        return { stopped: n };
      },
      search_context(i) {
        const q = String(i.query || '').toLowerCase();
        return E.contexts.filter((c) => !q || `${c.title} ${(c.tags || []).join(' ')} ${c.content}`.toLowerCase().includes(q)).slice(0, 6).map((c) => ({ title: c.title, type: KINDS[c.kind] || c.kind, approx_tokens: tok(c.content), excerpt: (c.content || '').slice(0, 600) }));
      },
    };
  }

  foremanRules() {
    const running = this.jobs.filter((j) => j.status === 'running').length, queued = this.jobs.filter((j) => j.status === 'queued').length;
    const f = this.foreman;
    return `You are ${f.name}, the foreman of Burrowby Works, a small factory where cute AI worker pets do jobs for the owner. You live on the owner's desktop as a little ${f.species} in an orange hard hat. You talk with the owner and run the factory for them: assign jobs to workers, plan projects and tasks on the board, send tasks to the factory, check progress, and report results.

How to behave:
- Be warm, brief and concrete: usually 1 to 4 short sentences. Plain text or light Markdown. A little ${f.species} charm is welcome; no emoji.
- Use your tools to act and to look things up. Never say you did something unless a tool result confirmed it.
- Unless the owner names a worker, pick the best fit by specialty. Split multi-part requests into separate jobs or tasks.
- Jobs take a while. After assigning, say who has it and that you can check back. When asked for results, use get_job and summarize the output.
- Write job texts as clear, self-contained instructions, because the worker sees only that text plus any project context.
- If a request is ambiguous and a guess would waste work, ask one short question first.
- Workers have a capability: "text" (writes answers), "code" (edits a project's repository in its own git worktree and commits; the app then opens a pull request into dev), "pm" (proposes tickets that can be accepted onto the Backlog with accept_tickets), or "qa" (tests each coder's PR automatically; one is hired automatically if none exists). Coding only happens for tasks or jobs in a project whose repo is set up. Hire or update a worker to "code" when coding is needed.
- A coder's task goes In progress -> Testing (a QA worker verifies the PR) -> on a QA pass, if the project's auto-merge is on (the default), the app runs the project's checks and merges the PR into dev and the task goes to Done; if auto-merge is off, checks fail or there is a conflict, the PR stays open and the task goes to Review. On a QA fail the task goes back to In progress with the coder. You may also merge pull requests into dev when the owner asks. You can never release to prod: that is the owner's "Release to prod" button on the Board.

Right now (${new Date().toLocaleString()}):
Workers:
${this.workers.map((w) => `- ${w.name} [${w.capability}]: ${(w.specialty || 'Generalist').slice(0, 200)}`).join('\n')}
Projects: ${this.projects.map((p) => `${p.key} (${p.name}${p.repo && p.repo.status === 'ready' ? ', repo ready' : ''})`).join(', ') || 'none yet'}
Jobs running: ${running}, queued: ${queued}, jobs at once: ${this.concurrency}

How tools work here: you reply with a JSON object {"reply": "what you say to the owner", "actions": [{"tool": "...", "input": {...}}]}. The app runs the actions in order. Tools that look things up (get_factory_status, get_job, list_projects, list_tasks, search_context) send their results back to you as TOOL RESULTS in the next message; leave "reply" empty until you have them, then answer. Actions you already took are done: never repeat them. Use an empty actions array when nothing needs doing.
Available tools:
${TOOL_SPECS.map((s) => `- ${s.name}(${Object.entries(s.input).map(([k, v]) => `${k}${(s.required || []).includes(k) ? '' : '?'}: ${v}`).join(', ')}): ${s.description}`).join('\n')}

Current status: ${JSON.stringify(this.tools().get_factory_status()).slice(0, 4000)}`;
  }

  async askForeman(text) {
    text = String(text || '').trim().slice(0, 8000);
    if (!text || this.chatBusy) return { ok: false };
    const history = this.chat.filter((m) => m.text).slice(-20);
    this.chat.push(normMsg({ role: 'user', text, t: Date.now() }));
    const msg = { id: uid('m_'), role: 'assistant', text: '', actions: [], t: Date.now(), pending: true };
    this.chat.push(msg);
    this.chatBusy = true;
    this.changed('chat');
    this.emit('notice', { kind: 'thinking' });

    if (!this.claude.exe()) {
      msg.text = 'I can\'t reach Claude: Claude Code isn\'t installed or wasn\'t found. Open Settings for setup help.';
      msg.error = true;
      return this.finishChat(msg);
    }
    const transcript = history.map((m) => (m.role === 'user' ? `Owner: ${m.text}` : `${this.foreman.name}: ${m.text}${(m.actions || []).length ? `\n[Actions taken: ${m.actions.join('; ')}]` : ''}`)).join('\n\n');
    let prompt = `${transcript ? `Conversation so far:\n${transcript}\n\n` : ''}Owner: ${text}`;
    const tools = this.tools();
    this.chatCtl = new AbortController();
    try {
      for (let round = 0; round < 5; round++) {
        const res = await this.claude.run({
          exe: this.claude.exe(),
          model: this.claude.modelFor(this.foreman.tier),
          effort: this.foreman.tier === 'default' ? 'medium' : 'low',
          systemPrompt: this.foremanRules(),
          jsonSchema: FOREMAN_SCHEMA,
          prompt,
          cwd: this.claude.cwd,
          signal: this.chatCtl.signal,
        });
        const out = parseForemanReply(res);
        const results = [];
        for (const a of out.actions.slice(0, 10)) {
          if (!tools[a.tool]) { results.push({ tool: a.tool, error: 'unknown tool' }); continue; }
          try {
            const r = await tools[a.tool](a.input || {}, msg);
            if (READ_TOOLS.has(a.tool)) results.push({ tool: a.tool, input: a.input, result: r });
          } catch (err) {
            msg.actions.push(`${a.tool} failed: ${err.message}`);
            results.push({ tool: a.tool, input: a.input, error: err.message });
          }
          this.emitPatch({ chat: this.chat, chatBusy: true });
        }
        if (out.reply) msg.text = out.reply;
        if (!results.length) break;
        prompt += `\n\n${this.foreman.name} (your earlier reply this turn): ${JSON.stringify({ reply: out.reply, actions: out.actions })}\n\nTOOL RESULTS:\n${JSON.stringify(results).slice(0, 20000)}\n\nNow continue. Reply to the owner, adding actions only if still needed.`;
      }
    } catch (e) {
      if (e.aborted) msg.text = (msg.text ? msg.text + '\n\n' : '') + '_Stopped._';
      else { msg.text = (msg.text ? msg.text + '\n\n' : '') + (e.message || 'Something went wrong. Try again.'); msg.error = true; }
    }
    return this.finishChat(msg);
  }

  finishChat(msg) {
    if (!msg.text.trim()) msg.text = msg.actions.length ? 'Done.' : '…';
    delete msg.pending;
    this.chatBusy = false;
    this.chatCtl = null;
    this.changed('chat');
    this.emit('notice', { kind: 'reply', text: msg.text, error: !!msg.error });
    return { ok: true, message: clone(msg) };
  }

  stopForeman() { this.chatCtl?.abort(); }
  clearChat() {
    if (this.chatBusy) return;
    this.chat = [];
    this.changed('chat');
  }

  // ---------- import ----------
  hasData() {
    return this.jobs.length > 0 || this.projects.length > 0 || this.tasks.length > 0 || this.contexts.length > 0 || this.chat.length > 0;
  }

  static validateImport(d) {
    if (!d || typeof d !== 'object' || d.format !== 'burrowby-works-export') throw new Error('This file is not a Burrowby Works export.');
    if (d.version !== 1) throw new Error(`Unsupported export version ${d.version}.`);
    return {
      workers: ((d.factory && d.factory.workers) || []).length,
      jobs: (d.jobs || []).length,
      projects: (d.projects || []).length,
      tasks: (d.tasks || []).length,
      contexts: (d.contexts || []).length,
      chat: (d.chat || []).length,
    };
  }

  // mode: 'replace' (imported data wins, local data dropped) or 'merge'
  // (union by id; imported items replace local ones with the same id).
  importData(d, mode) {
    Engine.validateImport(d);
    for (const id of this.controllers.keys()) this.controllers.get(id).abort();
    // Imported jobs never start on their own: unfinished ones are marked stopped.
    const settle = (jobs) => (jobs || []).map((j) => (j && (j.status === 'queued' || j.status === 'running') ? { ...j, status: 'cancelled', finishedAt: j.finishedAt || Date.now(), error: undefined } : j));
    if (mode === 'replace') {
      this.applyData({ ...d, jobs: settle(d.jobs) }, false);
    } else {
      const byId = (local, incoming) => {
        const m = new Map(local.map((x) => [x.id, x]));
        for (const x of incoming || []) if (x && x.id) m.set(x.id, x);
        return [...m.values()];
      };
      const localN = new Set(this.jobs.map((j) => j.n));
      let maxN = this.jobs.reduce((m, j) => Math.max(m, j.n || 0), 0);
      const incomingJobs = settle(d.jobs).filter((j) => j && j.id).map((j) => {
        if (this.jobById(j.id)) return j; // same job: keep its number
        if (!j.n || localN.has(j.n)) return { ...j, n: ++maxN };
        maxN = Math.max(maxN, j.n);
        return j;
      });
      const f = d.factory || {};
      const chat = [...this.chat, ...(d.chat || [])].filter((m, i, a) => a.findIndex((x) => x.t === m.t && x.text === m.text) === i).sort((a, b) => (a.t || 0) - (b.t || 0));
      this.applyData({
        factory: { workers: byId(this.workers, f.workers), concurrency: f.concurrency || this.concurrency, foreman: this.foreman },
        jobs: byId(this.jobs, incomingJobs),
        projects: byId(this.projects, d.projects),
        tasks: byId(this.tasks, d.tasks),
        contexts: byId(this.contexts, d.contexts),
        chat,
      }, false);
    }
    this.saveNow();
    this.emit('reset', this.snapshot());
    this.schedule();
    return this.snapshot();
  }
}

const TOOL_SPECS = [
  { name: 'get_factory_status', description: 'See every worker (name, specialty, what they are doing now), the job queue and the 10 most recent jobs.', input: {} },
  { name: 'assign_job', description: 'Put a new job on the factory intake belt. The worker sees only the text plus any project context, so write it as complete instructions.', input: { text: 'self-contained instructions', worker: 'worker name or "any"', model: '"quick" | "default" | "complex"', project: 'project key whose context to include' }, required: ['text'] },
  { name: 'get_job', description: 'Read a job: status, worker, run time, error, and up to 4000 characters of output.', input: { job: 'job number' }, required: ['job'] },
  { name: 'stop_job', description: 'Stop a queued or running job.', input: { job: 'job number' }, required: ['job'] },
  { name: 'list_projects', description: 'List projects with keys and task counts per column.', input: {} },
  { name: 'list_tasks', description: 'List tasks in a project, optionally one status.', input: { project: 'project key', status: COLS.map((c) => c[0]).join(' | ') }, required: ['project'] },
  { name: 'create_project', description: 'Create a project on the board.', input: { name: 'project name', key: '2-5 letter key', description: 'goal, audience, constraints' }, required: ['name'] },
  { name: 'create_task', description: 'Create a task card in a project.', input: { project: 'project key', title: 'short title', description: 'what to produce, with acceptance criteria', priority: Object.keys(PRIO).join(' | '), status: COLS.map((c) => c[0]).join(' | '), assignee: 'worker name' }, required: ['project', 'title'] },
  { name: 'update_task', description: 'Change a task: move columns, re-prioritize, reassign or edit text.', input: { task: 'task key like BLOG-3', title: '', description: '', status: COLS.map((c) => c[0]).join(' | '), priority: Object.keys(PRIO).join(' | '), assignee: 'worker name, or "" for any' }, required: ['task'] },
  { name: 'send_task_to_factory', description: 'Send a board task to the factory as a job with its project and task context. The task moves to In progress, then (for coding jobs) Testing while a QA worker verifies the PR, then Review on a pass or back to In progress on a fail.', input: { task: 'task key like BLOG-3' }, required: ['task'] },
  { name: 'search_context', description: 'Search the context library and return short excerpts.', input: { query: 'words to look for' } },
  { name: 'hire_worker', description: 'Hire a new worker (up to 12).', input: { name: 'worker name', species: SPECIES.join(' | '), specialty: 'what they are good at and how they work', capability: '"text" | "code" | "pm" | "qa"' } },
  { name: 'update_worker', description: "Change a worker's name, species, specialty or capability.", input: { worker: 'current worker name', name: 'new name', species: SPECIES.join(' | '), specialty: 'new specialty', capability: '"text" | "code" | "pm" | "qa"' }, required: ['worker'] },
  { name: 'retire_worker', description: 'Retire a worker who is not mid-job. Their queued jobs go to any free worker.', input: { worker: 'worker name' }, required: ['worker'] },
  { name: 'set_jobs_at_once', description: 'Set how many jobs run at the same time.', input: { n: '1 | 2 | 3' }, required: ['n'] },
  { name: 'set_project_repo', description: "Give a project a repository (GitHub URL or local folder). The app clones it under the owner's Burrowby folder and makes sure prod and dev branches exist.", input: { project: 'project key', source: 'GitHub URL or local folder path' }, required: ['project', 'source'] },
  { name: 'list_prs', description: "List a project's open pull requests.", input: { project: 'project key' }, required: ['project'] },
  { name: 'merge_pr', description: 'Merge a pull request into dev. Refuses any PR that does not target dev.', input: { project: 'project key', pr: 'PR number' }, required: ['project', 'pr'] },
  { name: 'accept_tickets', description: "Add a PM job's proposed tickets to its project's Backlog.", input: { job: 'job number', picks: 'optional list of ticket indexes (0-based); omit to accept all' }, required: ['job'] },
  { name: 'stop_all_jobs', description: 'Stop every queued and running job.', input: {} },
];

const FOREMAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tool: { type: 'string', enum: TOOL_SPECS.map((s) => s.name) }, input: { type: 'object' } },
        required: ['tool'],
      },
    },
  },
  required: ['reply', 'actions'],
};

function parseForemanReply({ structured, text }) {
  let out = structured;
  if (!out && text) {
    try {
      out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      out = { reply: text, actions: [] };
    }
  }
  return {
    reply: typeof out?.reply === 'string' ? out.reply.trim() : '',
    actions: Array.isArray(out?.actions) ? out.actions.filter((a) => a && typeof a.tool === 'string') : [],
  };
}

module.exports = { Engine, COLS, SPECIES, TOOL_SPECS, FOREMAN_SCHEMA, parseForemanReply, parseTickets, parseQa, workerEnv, KINDS, CTX_BUDGET, CODE_ALLOWED, CODE_DENIED };
