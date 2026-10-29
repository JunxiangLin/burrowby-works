// Burrowby Works main window. Ported from the Burrowby Works artifact: the UI,
// factory floor, charts, board and context library are the artifact's own code.
// Data and Claude calls go through the engine in the main process (window.works).
(() => {
// ---------- helpers ----------
const W = 960, H = 560;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const fmtDur = ms => ms == null || isNaN(ms) ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${String(Math.round(ms % 60000 / 1000)).padStart(2, '0')}s`;
const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString();
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej({ code: 'cancelled' }); }, { once: true }); });
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); }

// ---------- data ----------
const SPECIES = {
  bunny:   { body: '#F7EAF1', line: '#C7A2B5', belly: '#FFFFFF' },
  cat:     { body: '#FFCF94', line: '#D39A55', belly: '#FFF0DC' },
  bear:    { body: '#C99C77', line: '#93694A', belly: '#EBCFB4' },
  frog:    { body: '#9BDA86', line: '#64A955', belly: '#DDF5CF' },
  chick:   { body: '#FFE873', line: '#DDB52D', belly: '#FFF6C2' },
  axolotl: { body: '#FFC2D5', line: '#DF87A6', belly: '#FFE6EE' },
};
const NAMES = ['Mochi', 'Pip', 'Biscuit', 'Tofu', 'Clover', 'Wasabi', 'Juniper', 'Noodle', 'Pebble', 'Sprout', 'Maple', 'Dumpling', 'Bean', 'Kiwi', 'Waffle', 'Fig', 'Bao', 'Pudding', 'Sesame', 'Nori', 'Olive', 'Button', 'Toast'];
const DEFAULT_WORKERS = [
  { id: 'w_mochi', name: 'Mochi', species: 'bunny', specialty: 'Researcher. Explains topics clearly, compares options side by side, and says plainly what is uncertain.' },
  { id: 'w_biscuit', name: 'Biscuit', species: 'bear', specialty: 'Coder. Writes clean, working code with brief comments and a short usage example.' },
  { id: 'w_juniper', name: 'Juniper', species: 'cat', specialty: 'Writer. Drafts emails, posts and docs in a warm, plain voice. Keeps things short.' },
  { id: 'w_clover', name: 'Clover', species: 'frog', specialty: 'Analyst. Breaks problems into steps, makes rough estimates, and ends with a clear recommendation.' },
];
const EXAMPLES = [
  'Compare SQLite and Postgres for a small side project, in a short table',
  'Write a Python function that dedupes a list while keeping order',
  'Draft a friendly two-line reminder that the team offsite is Friday',
  'Estimate how many coffees a 40-person office drinks per week',
];
const TIER_LABEL = { default: 'balanced', quick: 'quick', complex: 'deep' };
const MAX_WORKERS = 12, MAX_OUTPUT = 60000;

let workers = DEFAULT_WORKERS.map(w => ({ ...w }));
let jobs = [];
let concurrency = 2;
let ready = false;
const vis = new Map();          // worker id -> visual state
const controllers = new Map();  // job id -> AbortController
let sampleFn = null, sampleBlocked = null, lastRateLimit = 0;
let projects = [], tasks = [], contexts = [];
const MAX_CTX = 80000;

// ---------- persistence ----------
const api = window.works;
const COLL = { context: 'contexts', projects: 'projects', tasks: 'tasks' };
// Writes go to the engine in the main process; it saves to disk and echoes
// the change back to every window.
const store = {
  mode: 'app',
  saveFactory() { api.setFactory({ workers: workers.map(w => ({ id: w.id, name: w.name, species: w.species, specialty: w.specialty, capability: w.capability || 'text' })), concurrency, foreman }); },
  saveJob() {},
  deleteJob(j) { api.deleteJobs([j.id]); },
  saveDoc(coll, o) { if (COLL[coll]) api.upsert(COLL[coll], JSON.parse(JSON.stringify(o))); },
  delDoc(coll, id) { if (COLL[coll]) api.remove(COLL[coll], id); },
  saveLocal() {},
};
let foreman = { name: 'Marmalade', species: 'cat', tier: 'quick' };
let chat = [];
const factoryDoc = () => ({ workers: workers.map(w => ({ id: w.id, name: w.name, species: w.species, specialty: w.specialty })), concurrency, foreman });
const JOB_FIELDS = ['id', 'n', 'text', 'pref', 'workerId', 'tier', 'status', 'createdAt', 'startedAt', 'firstTokenAt', 'finishedAt', 'output', 'error', 'tierApplied', 'inTok', 'outTok', 'simulated', 'truncated', 'ctx', 'taskId', 'projectId', 'retryOf', 'retries'];
function jobDoc(j) { const o = {}; for (const k of JOB_FIELDS) if (j[k] !== undefined && j[k] !== null) o[k] = k === 'output' ? String(j[k]).slice(0, MAX_OUTPUT) : j[k]; return o; }

// ---------- pet drawing ----------
function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rot, 0, Math.PI * 2); }
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawPet(c, sp_, x, y, opt = {}) {
  const sp = SPECIES[sp_] || SPECIES.bunny;
  const bob = opt.bob || 0, sx = opt.sx || 1, sy = opt.sy || 1, sc = opt.scale || 1;
  const eyesClosed = opt.blink || opt.sleep;
  c.save(); c.translate(x, y); c.scale(sc * (opt.face || 1), sc);
  c.lineWidth = 1.6; c.strokeStyle = sp.line;
  c.fillStyle = sp.line; ell(c, -6, -1, 4, 2.4); c.fill(); ell(c, 6, -1, 4, 2.4); c.fill();
  c.translate(0, bob);
  const by = -13, rx = 13.5 * sx, ry = 11.5 * sy;
  if (sp_ === 'bunny') {
    for (const s of [-1, 1]) { c.fillStyle = sp.body; ell(c, s * 6, by - 16, 3.8, 9.5, s * 0.22); c.fill(); c.stroke(); c.fillStyle = '#F7B3CC'; ell(c, s * 6, by - 15.5, 1.8, 6.5, s * 0.22); c.fill(); }
  } else if (sp_ === 'cat') {
    for (const s of [-1, 1]) { c.fillStyle = sp.body; c.beginPath(); c.moveTo(s * 12, by - 4); c.lineTo(s * 10.5, by - 17); c.lineTo(s * 3, by - 9); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#F7A9B8'; c.beginPath(); c.moveTo(s * 10.5, by - 7); c.lineTo(s * 10, by - 13.5); c.lineTo(s * 5.5, by - 9); c.closePath(); c.fill(); }
  } else if (sp_ === 'bear') {
    for (const s of [-1, 1]) { c.fillStyle = sp.body; ell(c, s * 10, by - 8.5, 5, 5); c.fill(); c.stroke(); c.fillStyle = sp.belly; ell(c, s * 10, by - 8.5, 2.5, 2.5); c.fill(); }
  } else if (sp_ === 'axolotl') {
    c.strokeStyle = '#E86F97'; c.lineWidth = 2.4; c.lineCap = 'round';
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const ang = -0.9 + i * 0.55; c.beginPath(); c.moveTo(s * 11, by - 3 + i * 3); c.lineTo(s * (11 + Math.cos(ang) * 7), by - 3 + i * 3 + Math.sin(ang) * 7); c.stroke(); }
    c.lineWidth = 1.6; c.strokeStyle = sp.line;
  }
  c.fillStyle = sp.body; ell(c, 0, by, rx, ry); c.fill(); c.stroke();
  c.fillStyle = sp.belly; ell(c, 0, by + 4, rx * 0.6, ry * 0.5); c.fill();
  if (sp_ === 'frog') for (const s of [-1, 1]) { c.fillStyle = sp.body; ell(c, s * 6.5, by - 9, 5.2, 5); c.fill(); c.stroke(); }
  if (sp_ === 'chick') {
    c.fillStyle = sp.body; c.strokeStyle = sp.line; c.lineWidth = 1.4;
    for (const s of [-1, 1]) { ell(c, s * 12.5, by + 2, 3.2, 5, s * -0.5); c.fill(); c.stroke(); }
    c.lineWidth = 1.6;
  }
  const ey = sp_ === 'frog' ? by - 9 : by - 1.5, ex = sp_ === 'frog' ? 6.5 : 4.8;
  c.fillStyle = '#2A2230'; c.strokeStyle = '#2A2230';
  for (const s of [-1, 1]) {
    if (sp_ === 'frog') { c.fillStyle = '#fff'; ell(c, s * ex, ey, 3.2, 3.2); c.fill(); c.fillStyle = '#2A2230'; }
    if (eyesClosed) { c.lineWidth = 1.4; c.beginPath(); c.arc(s * ex, ey - 0.5, 2, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
    else { ell(c, s * ex, ey, 2.1, 2.4); c.fill(); c.fillStyle = '#fff'; ell(c, s * ex + 0.7, ey - 0.9, 0.8, 0.8); c.fill(); c.fillStyle = '#2A2230'; }
  }
  c.fillStyle = 'rgba(255,120,150,.55)'; ell(c, -8.5, by + 2.5, 2.8, 1.7); c.fill(); ell(c, 8.5, by + 2.5, 2.8, 1.7); c.fill();
  c.strokeStyle = '#2A2230'; c.lineWidth = 1.2; c.lineCap = 'round';
  if (sp_ === 'chick') { c.fillStyle = '#FF9F43'; c.beginPath(); c.moveTo(-2.4, by + 1.2); c.lineTo(2.4, by + 1.2); c.lineTo(0, by + 4); c.closePath(); c.fill(); }
  else if (opt.focus) { c.beginPath(); c.moveTo(-1.6, by + 2.4); c.lineTo(1.6, by + 2.4); c.stroke(); }
  else { c.beginPath(); c.arc(-1.2, by + 1.6, 1.2, 0, Math.PI); c.stroke(); c.beginPath(); c.arc(1.2, by + 1.6, 1.2, 0, Math.PI); c.stroke(); }
  // tiny hard hat
  const top = sp_ === 'frog' ? by - 12 : by - ry + 1.5;
  c.fillStyle = opt.hat || '#FFC93D'; c.strokeStyle = opt.hatLine || '#D9A21C'; c.lineWidth = 1.2;
  c.beginPath(); c.ellipse(0, top + 1, 8, 6.5, 0, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
  ell(c, 0, top + 1.2, 10.5, 2.2); c.fill(); c.stroke();
  c.fillStyle = opt.hat ? 'rgba(255,255,255,.45)' : '#FFE08A'; c.fillRect(-1.2, top - 5, 2.4, 5);
  if (opt.boss) {
    c.save(); c.translate(12, by + 5); c.rotate(0.25);
    c.fillStyle = '#9C6E3E'; roundRect(c, -4.5, -6, 9, 12, 1.5); c.fill();
    c.fillStyle = '#FFFFFF'; c.fillRect(-3.2, -4, 6.4, 9);
    c.fillStyle = '#B9B2A6'; c.fillRect(-2.2, -2, 4.4, 0.9); c.fillRect(-2.2, 0, 4.4, 0.9); c.fillRect(-2.2, 2, 3, 0.9);
    c.fillStyle = '#C9CED6'; c.fillRect(-2, -7, 4, 2);
    c.restore();
  }
  c.restore();
}
function makeAvatar(species) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  drawPet(cv.getContext('2d'), species, 48, 86, { scale: 2.45 });
  return cv.toDataURL();
}
const avatarCache = new Map();
const avatar = sp => { if (!avatarCache.has(sp)) avatarCache.set(sp, makeAvatar(sp)); return avatarCache.get(sp); };

// ---------- factory layout ----------
const INTAKE = { x: 125, y: 500 }, SHIP = { x: 835, y: 470 }, REWORK = { x: 835, y: 214 };
const CORR_L = 152, CORR_R = 815;
let stations = [];
function layout() {
  const n = Math.max(1, workers.length);
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
  const x0 = 178, x1 = 798, y0 = 96, y1 = 548;
  const cw = (x1 - x0) / cols, ch = Math.min(170, (y1 - y0) / rows);
  const top = y0 + ((y1 - y0) - ch * rows) / 2;
  stations = workers.map((w, i) => { const c = i % cols, r = Math.floor(i / cols); return { x: x0 + cw * (c + 0.5), y: top + ch * r + ch * 0.42, aisle: top + ch * r + ch * 0.9, cw, ch }; });
}
function stationOf(w) { return stations[workers.indexOf(w)]; }
function V(w) {
  if (!vis.has(w.id)) { const st = stationOf(w) || { x: 480, y: 300 }; vis.set(w.id, { x: st.x, y: st.y + 4, path: [], state: 'idle', carry: null, jobId: null, face: 1, phase: Math.random() * 6, blinkAt: rand(1, 4), blinkT: 0, emote: null, idleSince: performance.now(), lastFail: 0 }); }
  return vis.get(w.id);
}
function routeTo(w, p, corr) { const st = stationOf(w), v = V(w); return [{ x: v.x, y: st.aisle }, { x: corr, y: st.aisle }, { x: corr, y: p.y }, { x: p.x, y: p.y }]; }
function routeHome(w, from, corr) { const st = stationOf(w); return [{ x: corr, y: from.y }, { x: corr, y: st.aisle }, { x: st.x, y: st.aisle }, { x: st.x, y: st.y + 4 }]; }
const workerFree = w => { const v = V(w); return v.state === 'idle' && !v.jobId; };

// ---------- jobs ----------
const byWorker = id => workers.find(w => w.id === id);
const jobById = id => jobs.find(j => j.id === id);
const isActive = j => j.status === 'queued' || j.status === 'running';
async function createJob(text, pref, tier, extra = {}) {
  return mergeJob(await api.createJob({ text, pref, tier, extra }));
}
function buildPrompt(j, w) {
  return `You are ${w.name}, a worker in a small agent factory.\nYour specialty and instructions: ${w.specialty || 'Generalist. Handle any job carefully.'}\n\nComplete the job below. Reply with the finished work only, with no preamble or sign-off. Use Markdown where it helps. Keep it under about 500 words unless the job clearly needs more.\n${contextBlock(j.ctx)}\nJob:\n${j.text}`;
}
function contextBlock(ids, cap = 60000) {
  const es = (ids || []).map(id => contexts.find(c => c.id === id)).filter(Boolean);
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
const ERROR_COPY = {
  not_granted: 'Claude access was declined for this page.', sampling_disabled: 'Claude is not available for this account.',
  rate_limited: 'Claude is rate-limiting this page. Try again in a little while.', refused: 'Claude declined this job. Try rewording it.',
  empty_completion: 'Claude returned nothing. Try a simpler job.', prompt_too_large: 'The job text is too long.',
  session_expired: 'Your session expired. Sign in again.', interrupted: 'The page closed while this job was running.',
  upstream_error: 'A connection problem interrupted the job.',
  timeout: 'The job ran longer than 15 minutes and was stopped.',
};
// Jobs run in the main process; the floor only animates them. When a job
// starts on a worker who is at their bench, they walk to the intake belt.
function syncVisuals() {
  for (const j of jobs) {
    if (j.status !== 'running' || !j.workerId) continue;
    const w = byWorker(j.workerId); if (!w) continue;
    const v = V(w);
    if (v.jobId === j.id || v.jobId || v.state !== 'idle') continue;
    v.state = 'fetch'; v.jobId = j.id; v.path = routeTo(w, INTAKE, CORR_L);
  }
}

// ---------- visuals ----------
function stepVisual(w, dt, now) {
  const v = V(w), st = stationOf(w); if (!st) return;
  if (v.emote) { v.emote.t -= dt; if (v.emote.t <= 0) v.emote = null; }
  v.blinkAt -= dt; if (v.blinkAt <= 0) { v.blinkT = 0.14; v.blinkAt = rand(2, 5); } if (v.blinkT > 0) v.blinkT -= dt;
  const j = v.jobId ? jobById(v.jobId) : null;
  if (v.path.length) {
    const p = v.path[0], dx = p.x - v.x, dy = p.y - v.y, d = Math.hypot(dx, dy), sp = 150;
    v.phase += dt * 12; if (Math.abs(dx) > 1) v.face = dx > 0 ? 1 : -1;
    if (d <= sp * dt) { v.x = p.x; v.y = p.y; v.path.shift(); } else { v.x += dx / d * sp * dt; v.y += dy / d * sp * dt; }
    if (v.path.length) return;
    if (v.state === 'fetch') { v.carry = 'crate'; v.state = 'return'; v.path = routeHome(w, INTAKE, CORR_L); }
    else if (v.state === 'return') { v.state = 'working'; v.face = 1; }
    else if (v.state === 'deliver') { const ok = v.carry === 'box'; v.carry = null; v.state = 'back'; v.path = routeHome(w, ok ? SHIP : REWORK, CORR_R); }
    else if (v.state === 'back') { v.state = 'idle'; v.jobId = null; v.idleSince = now; }
    return;
  }
  if (v.state === 'working') {
    v.phase += dt * 5;
    if (!j || j.status !== 'running') {
      if (j && j.status === 'cancelled') { v.carry = null; v.state = 'idle'; v.jobId = null; v.idleSince = now; return; }
      const ok = j && j.status === 'done';
      v.carry = ok ? 'box' : 'broken'; v.emote = { kind: ok ? 'sparkle' : 'error', t: 1.6, max: 1.6 };
      v.state = 'deliver'; v.path = routeTo(w, ok ? SHIP : REWORK, CORR_R);
    }
    return;
  }
  if (v.state === 'idle') {
    v.phase += dt * 2;
    const hx = st.x, hy = st.y + 4;
    if (Math.hypot(v.x - hx, v.y - hy) > 2) v.path = [{ x: v.x, y: st.aisle }, { x: hx, y: st.aisle }, { x: hx, y: hy }];
  }
}

const bg = document.createElement('canvas');
function drawBackground() {
  const R = 2; bg.width = W * R; bg.height = H * R;
  const c = bg.getContext('2d'); c.scale(R, R);
  c.fillStyle = '#EDE6D8'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(150,130,100,.13)'; c.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { c.beginPath(); c.moveTo(x, 64); c.lineTo(x, H); c.stroke(); }
  for (let y = 64; y <= H; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.strokeStyle = 'rgba(232,180,40,.55)'; c.lineWidth = 2; c.setLineDash([10, 8]);
  for (const x of [CORR_L - 16, CORR_L + 16, CORR_R - 16, CORR_R + 16]) { c.beginPath(); c.moveTo(x, 72); c.lineTo(x, H - 8); c.stroke(); }
  c.setLineDash([]);
  c.fillStyle = '#B9C6CF'; c.fillRect(0, 0, W, 64);
  c.fillStyle = '#A3B1BB'; c.fillRect(0, 56, W, 8);
  for (let i = 0; i < 6; i++) { const x = 230 + i * 92; c.fillStyle = '#7E8E9A'; roundRect(c, x, 12, 60, 34, 6); c.fill(); c.fillStyle = '#D9EEF7'; roundRect(c, x + 4, 16, 52, 26, 4); c.fill(); c.strokeStyle = '#7E8E9A'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 30, 16); c.lineTo(x + 30, 42); c.stroke(); }
  c.strokeStyle = '#8C9AA5'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, 8); c.lineTo(W, 8); c.stroke();
  c.fillStyle = '#FFFDF6'; roundRect(c, 18, 14, 180, 32, 10); c.fill(); c.strokeStyle = '#DC5434'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#3A2A2A'; c.font = '800 18px "Baloo 2", Figtree, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BURROWBY WORKS', 108, 31.5);
  c.fillStyle = '#5B616B'; roundRect(c, 34, 92, 72, 440, 10); c.fill();
  c.fillStyle = '#3F444C'; roundRect(c, 42, 98, 56, 428, 6); c.fill();
  hazard(c, 34, 536, 72, 10);
  label(c, 70, 84, 'INTAKE', '#3E8FB0');
  c.fillStyle = 'rgba(0,0,0,.12)'; ell(c, 892, 528, 54, 8); c.fill();
  c.fillStyle = '#B98A5E'; c.fillRect(846, 506, 92, 8); c.fillRect(846, 520, 92, 6);
  c.fillStyle = '#8F6640'; for (const x of [848, 886, 926]) c.fillRect(x, 512, 10, 10);
  label(c, 892, 548, 'SHIPPED', '#2C8C58');
  c.fillStyle = 'rgba(0,0,0,.12)'; ell(c, 892, 250, 44, 7); c.fill();
  c.fillStyle = '#8A8F99'; c.beginPath(); c.moveTo(852, 186); c.lineTo(932, 186); c.lineTo(924, 248); c.lineTo(860, 248); c.closePath(); c.fill();
  c.fillStyle = '#6E737D'; roundRect(c, 848, 180, 88, 10, 4); c.fill();
  label(c, 892, 170, 'REWORK', '#C93A3A');
  for (const [x, y] of [[930, 100], [140, 548], [790, 550]]) { c.fillStyle = '#C46A4A'; c.fillRect(x - 9, y - 12, 18, 14); c.fillStyle = '#5DA857'; ell(c, x - 6, y - 20, 7, 10, -0.4); c.fill(); ell(c, x + 6, y - 20, 7, 10, 0.4); c.fill(); ell(c, x, y - 26, 6, 10); c.fill(); }
}
function hazard(c, x, y, w, h) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = '#2E2E2E'; c.fillRect(x, y, w, h); c.fillStyle = '#FFC93D'; for (let i = -h; i < w; i += 12) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + 6, y + h); c.lineTo(x + i + 6 + h, y); c.lineTo(x + i + h, y); c.closePath(); c.fill(); } c.restore(); }
function label(c, x, y, text, col) {
  c.font = '800 11px Figtree, system-ui, sans-serif';
  const w = c.measureText(text).width + 16;
  c.fillStyle = col; roundRect(c, x - w / 2, y - 9, w, 18, 9); c.fill();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + 0.5);
}
function drawCrate(c, x, y, kind, n) {
  c.save(); c.translate(x, y);
  if (kind === 'box') {
    c.fillStyle = '#D9A86C'; roundRect(c, -10, -9, 20, 16, 2); c.fill(); c.strokeStyle = '#B5844A'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#F06292'; c.fillRect(-1.6, -9, 3.2, 16); c.fillRect(-10, -2.6, 20, 3.2);
    ell(c, -3, -10.5, 3, 2, -0.5); c.fill(); ell(c, 3, -10.5, 3, 2, 0.5); c.fill();
  } else if (kind === 'broken') {
    c.fillStyle = '#A0A4AC'; roundRect(c, -10, -9, 20, 16, 2); c.fill();
    c.strokeStyle = '#C93A3A'; c.lineWidth = 2.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(-5, -5); c.lineTo(5, 3); c.moveTo(5, -5); c.lineTo(-5, 3); c.stroke();
  } else {
    c.fillStyle = '#C8955C'; roundRect(c, -11, -10, 22, 18, 2); c.fill();
    c.strokeStyle = '#9C6E3E'; c.lineWidth = 1.2; c.stroke(); c.beginPath(); c.moveTo(-11, -1); c.lineTo(11, -1); c.stroke();
    c.fillStyle = '#F2E3C6'; c.fillRect(-8, -8, 16, 6);
    if (n != null) { c.fillStyle = '#5A3E22'; c.font = '700 8px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('#' + n, 0, -4.8); }
  }
  c.restore();
}

const canvas = $('world'), ctx = canvas.getContext('2d');
let scale = 1, dpr = 1, rt = 0, hoverId = null;
function fit() {
  const host = $('floor');
  const cw = host.clientWidth - 12, ch = host.clientHeight - 12;
  scale = Math.max(0.2, Math.min(cw / W, ch / H));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${W * scale}px`; canvas.style.height = `${H * scale}px`;
  canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
}
new ResizeObserver(fit).observe($('floor'));
function intakeCrates() {
  return jobs.filter(j => {
    if (j.status === 'queued') return true;
    if (j.status !== 'running') return false;
    const w = byWorker(j.workerId); if (!w) return false;
    const v = V(w); return v.state === 'fetch' && v.jobId === j.id;
  });
}
const crateSlot = i => ({ x: 70, y: 498 - i * 44 });

function drawEmote(c, e, x, y) {
  if (!e) return;
  const k = Math.min(1, (e.max - e.t) * 6), fl = Math.min(1, e.t * 3);
  c.save(); c.globalAlpha = fl; c.translate(x, y - (1 - fl) * 6); c.scale(k, k);
  if (e.kind === 'sparkle') { c.fillStyle = '#FFC93D'; c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 2.4 : 8, a = i * Math.PI / 4 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); }
  else if (e.kind === 'heart') { c.fillStyle = '#FF5C8A'; c.beginPath(); c.moveTo(0, 4); c.bezierCurveTo(-9, -3, -5, -10, 0, -5); c.bezierCurveTo(5, -10, 9, -3, 0, 4); c.fill(); }
  else { c.fillStyle = '#E5484D'; ell(c, 0, 0, 7.5, 7.5); c.fill(); c.fillStyle = '#fff'; c.font = '800 11px Figtree, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', 0, 0.5); }
  c.restore();
}
function pill(c, x, y, text, col) {
  c.font = '600 10px "IBM Plex Mono", monospace';
  const w = c.measureText(text).width + 12;
  const bx = clamp(x - w / 2, 4, W - w - 4);
  c.fillStyle = 'rgba(255,255,255,.95)'; roundRect(c, bx, y - 9, w, 17, 8.5); c.fill();
  c.strokeStyle = col; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = '#2B2A27'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, bx + 6, y);
}
function drawWorker(c, w, v, now) {
  const st = v.state;
  let bob = 0, sx = 1, sy = 1;
  if (v.path.length) { const s = Math.abs(Math.sin(v.phase)); bob = -s * 3.5; sx = 1 + (1 - s) * 0.06; sy = 1 - (1 - s) * 0.06; }
  else if (st === 'working') { bob = -Math.abs(Math.sin(v.phase * 2)) * 1.8; }
  else { const br = Math.sin(rt * 2.2 + w.name.length) * 0.03; sy = 1 + br; sx = 1 - br; }
  const sleepy = st === 'idle' && !v.path.length && now - v.idleSince > 25000;
  c.fillStyle = 'rgba(60,50,30,.2)'; ell(c, v.x, v.y + 1, 13, 4); c.fill();
  if (w.id === selWorker) { c.strokeStyle = '#DC5434'; c.lineWidth = 2.2; c.setLineDash([5, 4]); c.lineDashOffset = -rt * 12; ell(c, v.x, v.y + 1, 19, 7); c.stroke(); c.setLineDash([]); }
  drawPet(c, w.species, v.x, v.y, { bob, sx, sy, face: v.face, blink: v.blinkT > 0, sleep: sleepy, focus: st === 'working', scale: w.id === hoverId ? 1.12 : 1 });
  if (v.carry) drawCrate(c, v.x, v.y - 42 + bob, v.carry);
  if (sleepy) {
    c.font = '700 11px Figtree, sans-serif'; c.fillStyle = 'rgba(255,255,255,.95)'; c.strokeStyle = 'rgba(80,80,110,.6)'; c.lineWidth = 2.5; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const ph = (rt * 0.6 + w.name.length * 0.1) % 1; c.globalAlpha = 1 - ph;
    c.strokeText('z', v.x + 10 + ph * 8, v.y - 38 - ph * 12); c.fillText('z', v.x + 10 + ph * 8, v.y - 38 - ph * 12); c.globalAlpha = 1;
  }
}
function drawStation(c, w, st, now) {
  const v = V(w), x = st.x, y = st.y;
  const j = v.jobId ? jobById(v.jobId) : null;
  const working = v.state === 'working' && !v.path.length;
  const failRecent = now - v.lastFail < 4000;
  c.fillStyle = 'rgba(120,100,70,.09)'; roundRect(c, x - st.cw / 2 + 14, y - 46, st.cw - 28, Math.min(st.ch - 18, 96), 12); c.fill();
  if (!v.path.length && (v.state === 'idle' || v.state === 'working')) drawWorker(c, w, v, now);
  c.fillStyle = '#5C6478'; roundRect(c, x - 60, y - 26, 34, 30, 4); c.fill();
  c.fillStyle = working ? '#1E3A2E' : failRecent ? '#4A1E22' : '#2E3442'; roundRect(c, x - 56, y - 22, 26, 19, 2); c.fill();
  if (working) {
    c.strokeStyle = '#7CF0A8'; c.lineWidth = 1.2;
    const L = j && j.firstTokenAt ? 4 : 2;
    for (let i = 0; i < L; i++) { const len = 6 + ((Math.sin(rt * 5 + i * 1.7) + 1) * 7); c.beginPath(); c.moveTo(x - 53, y - 18 + i * 4); c.lineTo(x - 53 + len, y - 18 + i * 4); c.stroke(); }
  } else if (Math.sin(rt * 4) > 0) { c.fillStyle = '#8FA0B8'; c.fillRect(x - 53, y - 9, 4, 2); }
  const lampCol = working ? '#FFB020' : failRecent ? '#FF5A5A' : '#5BD18A';
  c.fillStyle = lampCol; ell(c, x - 43, y - 30, 3.2, 3.2); c.fill();
  if (working) { c.fillStyle = 'rgba(255,176,32,.25)'; ell(c, x - 43, y - 30, 7, 7); c.fill(); }
  c.fillStyle = '#C79A6B'; roundRect(c, x - 66, y + 2, 132, 12, 4); c.fill();
  c.fillStyle = '#A87A4E'; c.fillRect(x - 64, y + 12, 128, 18);
  c.fillStyle = '#7E5A38'; c.fillRect(x - 62, y + 30, 6, 6); c.fillRect(x + 56, y + 30, 6, 6);
  c.fillStyle = '#F7F1E3'; roundRect(c, x - 34, y + 15, 68, 12, 3); c.fill();
  c.fillStyle = '#3A2A1E'; c.font = '700 9px Figtree, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(w.name.toUpperCase(), x, y + 21.5);
  if (working) {
    drawCrate(c, x + 40, y - 2, 'crate', j ? j.n : null);
    for (let i = 0; i < 3; i++) { const ph = (rt * 1.3 + i / 3) % 1; c.fillStyle = `rgba(255,201,61,${1 - ph})`; ell(c, x + 30 + Math.sin(i * 2.1 + rt) * 10, y - 14 - ph * 16, 1.6, 1.6); c.fill(); }
  }
  if (working && j) {
    const el = Date.now() - j.startedAt;
    const txt = j.firstTokenAt ? `writing · ${fmtNum((j.output || '').length)} chars` : `thinking · ${Math.floor(el / 1000)}s`;
    pill(c, x, y - 54, `#${j.n} ${txt}`, j.firstTokenAt ? '#DC5434' : '#E9A23B');
  } else if (v.state === 'idle' && !v.path.length) {
    const q = jobs.filter(q => q.status === 'queued' && q.pref === w.id).length;
    if (q) pill(c, x, y - 54, `${q} waiting`, '#B4AEA2');
  }
  drawEmote(c, v.emote, x, y - 46);
}
function render(t) {
  rt = t / 1000;
  const c = ctx, now = performance.now();
  c.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  c.clearRect(0, 0, W, H);
  if (bg.width) c.drawImage(bg, 0, 0, W, H);
  const crates = intakeCrates();
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2;
  const off = crates.length ? (rt * 24) % 16 : 0;
  for (let y = 100 + off; y < 524; y += 16) { c.beginPath(); c.moveTo(44, y); c.lineTo(96, y); c.stroke(); }
  crates.slice(0, 9).forEach((j, i) => { const p = crateSlot(i); drawCrate(c, p.x, p.y, 'crate', j.n); });
  if (crates.length > 9) pill(c, 70, 104, `+${crates.length - 9} more`, '#3E8FB0');
  const done = jobs.filter(j => j.status === 'done').length, failed = jobs.filter(j => j.status === 'failed').length;
  const shown = Math.min(done, 12);
  for (let i = 0; i < shown; i++) { const col = i % 4, row = Math.floor(i / 4); drawCrate(c, 858 + col * 23, 500 - row * 18, 'box'); }
  if (done) pill(c, 892, 470 - Math.ceil(shown / 4) * 18, `${done} shipped`, '#2C8C58');
  for (let i = 0; i < Math.min(failed, 3); i++) drawCrate(c, 874 + i * 18, 196 + (i % 2) * 3, 'broken');
  if (failed) pill(c, 892, 270, `${failed} failed`, '#C93A3A');
  workers.forEach((w, i) => { if (stations[i]) drawStation(c, w, stations[i], now); });
  const walkers = workers.filter(w => V(w).path.length).sort((a, b) => V(a).y - V(b).y);
  for (const w of walkers) {
    const v = V(w); drawWorker(c, w, v, now);
    c.font = '700 10px Figtree, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeText(w.name, v.x, v.y + 5); c.fillStyle = '#2D2A24'; c.fillText(w.name, v.x, v.y + 5);
    drawEmote(c, v.emote, v.x, v.y - 60);
  }
}
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000)); lastT = t;
  syncVisuals();
  const now = performance.now();
  for (const w of workers) stepVisual(w, dt, now);
  render(t);
  stepForeman(dt, t);
  requestAnimationFrame(frame);
}

// ---------- metrics ----------
const finished = () => jobs.filter(j => j.status === 'done' || j.status === 'failed');
const runMs = j => (j.finishedAt || Date.now()) - j.startedAt;
const ttft = j => j.firstTokenAt ? j.firstTokenAt - j.startedAt : null;
const waitMs = j => (j.startedAt || (j.status === 'cancelled' ? j.finishedAt : null) || Date.now()) - j.createdAt;
function busyMs(w, win) {
  const from = Date.now() - win; let s = 0;
  for (const j of jobs) if (j.workerId === w.id && j.startedAt) { const a = Math.max(from, j.startedAt), b = j.finishedAt || Date.now(); if (b > a) s += b - a; }
  return s;
}
function workerStats(w) {
  const js = jobs.filter(j => j.workerId === w.id && (j.status === 'done' || j.status === 'failed'));
  const ok = js.filter(j => j.status === 'done');
  const runs = ok.map(runMs);
  return { total: js.length, ok: ok.length, failed: js.length - ok.length, succ: js.length ? ok.length / js.length : null, p50: runs.length ? pct(runs, .5) : null, p95: runs.length ? pct(runs, .95) : null, out: js.reduce((s, j) => s + (j.outTok || 0), 0), tin: js.reduce((s, j) => s + (j.inTok || 0), 0), util: Math.min(1, busyMs(w, 3600e3) / 3600e3) };
}
function workerStatus(w) {
  const v = V(w);
  if (v.state === 'fetch') return ['fetching job', 'var(--s-walk)'];
  if (v.state === 'return') return ['carrying job', 'var(--s-walk)'];
  if (v.state === 'working') { const j = jobById(v.jobId); return j && j.firstTokenAt ? ['writing', 'var(--s-write)'] : ['thinking', 'var(--s-think)']; }
  if (v.state === 'deliver') return ['delivering', 'var(--s-walk)'];
  if (v.state === 'back') return ['heading back', 'var(--s-walk)'];
  return ['idle', 'var(--s-idle)'];
}
const STATUS = { queued: ['queued', 'var(--s-wait)'], running: ['running', 'var(--s-think)'], done: ['shipped', 'var(--ok)'], failed: ['failed', 'var(--crit)'], cancelled: ['stopped', 'var(--s-idle)'] };

// ---------- markdown ----------
function inline(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>'); }
function md(src) {
  const lines = esc(src).split('\n'); let out = '', code = false, list = null, para = [];
  const flushP = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  const closeL = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const ln of lines) {
    if (/^\s*```/.test(ln)) { flushP(); closeL(); out += code ? '</code></pre>' : '<pre><code>'; code = !code; continue; }
    if (code) { out += ln + '\n'; continue; }
    let m;
    if ((m = ln.match(/^(#{1,6})\s+(.*)/))) { flushP(); closeL(); out += `<h4>${inline(m[2])}</h4>`; }
    else if ((m = ln.match(/^\s*[-*+]\s+(.*)/))) { flushP(); if (list !== 'ul') { closeL(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { closeL(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (/^\s*\|/.test(ln)) { flushP(); closeL(); if (!/^\s*\|[\s:|-]+\|?\s*$/.test(ln)) out += `<pre><code>${ln}</code></pre>`; }
    else if (!ln.trim()) { flushP(); closeL(); }
    else { closeL(); para.push(ln); }
  }
  if (code) out += '</code></pre>';
  flushP(); closeL();
  return out.replace(/<\/code><\/pre><pre><code>/g, '\n');
}

// ---------- dashboard ----------
let tab = lsGet('burrowby.works.tab') || 'overview';
let selJob = null, selWorker = null, jobFilter = 'all', holdRender = false;

function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function legendItems(items) { return items.map(([c, l, v]) => `<span><i style="background:${c}"></i>${l}${v != null ? `<b>${v}</b>` : ''}</span>`).join(''); }
function legend(items) { return `<div class="legend">${legendItems(items)}</div>`; }
function jobsChart(list) {
  const w = 340, h = 150, pl = 40, pr = 8, pt = 10, pb = 22;
  const tot = list.map(j => waitMs(j) + runMs(j));
  const max = niceMax(Math.max(1000, ...tot));
  const n = Math.max(list.length, 8), bw = (w - pl - pr) / n;
  const y = v => pt + (h - pt - pb) * (1 - v / max);
  const fy = v => v >= 60000 ? `${(v / 60000).toFixed(v % 60000 ? 1 : 0)}m` : `${Math.round(v / 1000)}s`;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Time breakdown of recent jobs">`;
  for (const f of [0, 0.5, 1]) { const yy = y(max * f); s += `<line x1="${pl}" x2="${w - pr}" y1="${yy}" y2="${yy}" style="stroke:var(--line)"/><text x="${pl - 6}" y="${yy + 3.5}" text-anchor="end" style="fill:var(--muted);font:10px var(--f-mono)">${fy(max * f)}</text>`; }
  list.forEach((j, i) => {
    const x = pl + i * bw + bw * 0.18, bwi = bw * 0.64;
    const wt = waitMs(j), th = ttft(j) ?? runMs(j), wr = j.firstTokenAt ? runMs(j) - th : 0;
    let base = 0;
    for (const [val, col] of [[wt, 'var(--s-wait)'], [th, 'var(--s-think)'], [wr, j.status === 'failed' ? 'var(--crit)' : 'var(--s-write)']]) {
      if (val <= 0) continue; const y0 = y(base), y1 = y(base + val);
      s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bwi.toFixed(1)}" height="${Math.max(0.8, y0 - y1).toFixed(1)}" style="fill:${col}"/>`; base += val;
    }
    if (j.status === 'failed') s += `<text x="${(x + bwi / 2).toFixed(1)}" y="${(y(base) - 3).toFixed(1)}" text-anchor="middle" style="fill:var(--crit);font:700 10px var(--f-mono)">×</text>`;
    if (list.length <= 12 || i % 2 === 0) s += `<text x="${(x + bwi / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" style="fill:var(--muted);font:9px var(--f-mono)">${j.n}</text>`;
  });
  return s + '</svg>';
}
function throughputChart() {
  const w = 340, h = 120, pl = 40, pr = 8, pt = 10, pb = 22, B = 12, span = 5 * 60e3, now = Date.now();
  const bins = Array.from({ length: B }, () => ({ ok: 0, bad: 0 }));
  for (const j of finished()) { const i = Math.floor((j.finishedAt - (now - B * span)) / span); if (i >= 0 && i < B) bins[i][j.status === 'done' ? 'ok' : 'bad']++; }
  const max = niceMax(Math.max(2, ...bins.map(b => b.ok + b.bad)));
  const bw = (w - pl - pr) / B, y = v => pt + (h - pt - pb) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Jobs finished per five minutes">`;
  for (const f of [0, 0.5, 1]) { const yy = y(max * f); s += `<line x1="${pl}" x2="${w - pr}" y1="${yy}" y2="${yy}" style="stroke:var(--line)"/><text x="${pl - 6}" y="${yy + 3.5}" text-anchor="end" style="fill:var(--muted);font:10px var(--f-mono)">${Math.round(max * f * 10) / 10}</text>`; }
  bins.forEach((b, i) => {
    const x = pl + i * bw + bw * 0.15, bwi = bw * 0.7;
    if (b.ok) s += `<rect x="${x.toFixed(1)}" y="${y(b.ok).toFixed(1)}" width="${bwi.toFixed(1)}" height="${(y(0) - y(b.ok)).toFixed(1)}" rx="2" style="fill:var(--ok)"/>`;
    if (b.bad) s += `<rect x="${x.toFixed(1)}" y="${y(b.ok + b.bad).toFixed(1)}" width="${bwi.toFixed(1)}" height="${(y(b.ok) - y(b.ok + b.bad)).toFixed(1)}" rx="2" style="fill:var(--crit)"/>`;
  });
  s += `<text x="${pl}" y="${h - 6}" style="fill:var(--muted);font:10px var(--f-mono)">60 min ago</text><text x="${w - pr}" y="${h - 6}" text-anchor="end" style="fill:var(--muted);font:10px var(--f-mono)">now</text>`;
  return s + '</svg>';
}
function alerts() {
  const out = [];
  const last = finished().sort((a, b) => a.finishedAt - b.finishedAt).slice(-10);
  const bad = last.filter(j => j.status === 'failed').length;
  if (last.length >= 3 && bad >= 3) out.push(['crit', `${bad} of the last ${last.length} jobs failed. Open the Jobs tab to see why.`]);
  const queued = jobs.filter(j => j.status === 'queued');
  const oldest = queued.length ? Math.max(...queued.map(waitMs)) : 0;
  if (oldest > 120e3) out.push(['warn', `A job has waited ${fmtDur(oldest)} in the queue. Allow more jobs at once or assign it to another worker.`]);
  for (const j of jobs.filter(j => j.status === 'running' && runMs(j) > 180e3)) out.push(['warn', `Job #${j.n} has been running for ${fmtDur(runMs(j))}.`]);
  if (Date.now() - lastRateLimit < 10 * 60e3) out.push(['warn', 'Your Claude plan hit a usage limit in the last 10 minutes.']);
  for (const j of jobs.filter(j => j.merge && j.merge.status === 'blocked' && j.pr && !j.pr.merged && j.finishedAt > Date.now() - 24 * 3600e3)) { const t = j.taskId && taskById(j.taskId); out.push(['warn', `PR #${j.pr.number}${t ? ` (${taskKey(t)})` : ''} was not auto-merged: ${j.merge.reason}. It is open for you on GitHub.`]); }
  if (ready && !sampleFn) out.push(['info', `${cliInfo.message} New jobs wait in the queue until it's ready.`]);
  return out;
}
function renderOverview() {
  const fin = finished(), ok = fin.filter(j => j.status === 'done');
  const hour = Date.now() - 3600e3;
  const runs = ok.map(runMs), tt = ok.map(ttft).filter(v => v != null);
  const queued = jobs.filter(j => j.status === 'queued');
  const waits = jobs.filter(j => j.startedAt).map(waitMs);
  const cancelled = jobs.filter(j => j.status === 'cancelled').length;
  const outTok = jobs.reduce((s, j) => s + (j.outTok || 0), 0), inTok = jobs.reduce((s, j) => s + (j.inTok || 0), 0);
  const recent = jobs.filter(j => j.startedAt).sort((a, b) => a.startedAt - b.startedAt).slice(-20);
  const al = alerts();
  $('p-overview').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="label">Jobs shipped</span><span class="v">${ok.length}</span><span class="d">${ok.filter(j => j.finishedAt > hour).length} in the last hour</span></div>
      <div class="kpi"><span class="label">Success rate</span><span class="v">${fin.length ? (ok.length / fin.length * 100).toFixed(0) : '–'}<small>${fin.length ? '%' : ''}</small></span><span class="d">${fin.length - ok.length} failed · ${cancelled} stopped</span></div>
      <div class="kpi"><span class="label">Run time p50</span><span class="v">${runs.length ? fmtDur(pct(runs, .5)) : '–'}</span><span class="d">p95 ${runs.length ? fmtDur(pct(runs, .95)) : '–'}</span></div>
      <div class="kpi"><span class="label">First token p50</span><span class="v">${tt.length ? fmtDur(pct(tt, .5)) : '–'}</span><span class="d">p95 ${tt.length ? fmtDur(pct(tt, .95)) : '–'}</span></div>
      <div class="kpi"><span class="label">In the queue</span><span class="v">${queued.length}</span><span class="d">avg wait ${waits.length ? fmtDur(waits.reduce((a, b) => a + b, 0) / waits.length) : '–'}</span></div>
      <div class="kpi"><span class="label">≈ Tokens out</span><span class="v">${fmtNum(outTok)}</span><span class="d">≈ ${fmtNum(inTok)} in · chars ÷ 4</span></div>
    </div>
    <div class="section">
      <div class="section-h"><h3>Alerts</h3><span class="sub">${al.length} open</span></div>
      <div class="alerts">${al.length ? al.map(([s, t]) => `<div class="alert"><span class="sev ${s}">${s === 'crit' ? 'critical' : s === 'warn' ? 'warning' : 'info'}</span><span>${esc(t)}</span></div>`).join('') : `<div class="alert"><span class="sev ok">ok</span><span>${fin.length ? 'All recent jobs look healthy.' : 'No jobs yet. Describe one above to start the line.'}</span></div>`}</div>
    </div>
    <div class="section">
      <div class="section-h"><h3>Where the time goes</h3><span class="sub">last ${recent.length} jobs, by #</span></div>
      ${recent.length ? jobsChart(recent) : '<div class="empty">Each job will show up as a bar split into queue wait, thinking, and writing.</div>'}
      ${legend([['var(--s-wait)', 'queued'], ['var(--s-think)', 'thinking (to first token)'], ['var(--s-write)', 'writing']])}
    </div>
    <div class="section">
      <div class="section-h"><h3>Throughput</h3><span class="sub">jobs per 5 min</span></div>
      ${throughputChart()}
      ${legend([['var(--ok)', 'shipped'], ['var(--crit)', 'failed']])}
    </div>
    <div class="section">
      <div class="section-h"><h3>Worker utilization</h3><span class="sub">busy share, last hour</span></div>
      <div class="util">${workers.map(w => { const u = Math.min(1, busyMs(w, 3600e3) / 3600e3); const [st] = workerStatus(w); return `<span>${esc(w.name)} <span style="color:var(--muted)">· ${st}</span></span><div class="track"><span style="width:${(u * 100).toFixed(1)}%"></span></div><span class="n">${(u * 100).toFixed(0)}%</span>`; }).join('')}</div>
    </div>`;
}
function renderJobs() {
  const list = jobs.filter(j => jobFilter === 'all' || (jobFilter === 'active' ? isActive(j) : jobFilter === 'done' ? j.status === 'done' : j.status === 'failed' || j.status === 'cancelled')).slice().reverse();
  $('jobList').innerHTML = list.length ? list.map(j => {
    const w = byWorker(j.workerId || j.pref); const [sl, sc] = STATUS[j.status];
    const dur = j.status === 'queued' ? `waiting ${fmtDur(waitMs(j))}` : j.startedAt ? fmtDur(runMs(j)) : '–';
    return `<div class="job ${j.id === selJob ? 'sel' : ''}" data-id="${j.id}" role="button" tabindex="0">
      <img src="${avatar(w ? w.species : 'chick')}" alt="">
      <span class="txt">#${j.n} ${esc(j.text)}</span>
      <span class="pill" style="--c:${sc}">${sl}</span>
      <span class="meta">${j.taskId && taskById(j.taskId) ? `<span>${esc(taskKey(taskById(j.taskId)))}</span>` : ''}${j.ctx && j.ctx.length ? `<span>${j.ctx.length} ctx</span>` : ''}<span>${w ? esc(w.name) : 'any worker'}</span><span>${dur}</span><span>≈${fmtNum(j.outTok || 0)} tok</span><span>${TIER_LABEL[j.tierApplied || j.tier] || ''}</span>${j.kind === 'code' ? '<span>code</span>' : j.kind === 'pm' ? '<span>pm</span>' : ''}${j.pr ? `<span>PR #${j.pr.number}</span>` : ''}${j.simulated ? '<span>simulated</span>' : ''}<span>${ago(j.createdAt)}</span></span>
    </div>`;
  }).join('') : `<div class="empty">${jobs.length ? 'No jobs match this filter.' : 'No jobs yet. Describe one above and press Assign job.'}</div>`;
  paintJobDetail();
}
let paintedOut = { id: null, len: -1, status: null };
function paintJobDetail() {
  const j = jobById(selJob), box = $('jobDetail');
  if (!j) { box.hidden = true; return; }
  box.hidden = false;
  const w = byWorker(j.workerId || j.pref); const [sl] = STATUS[j.status];
  $('jdAvatar').src = avatar(w ? w.species : 'chick');
  $('jdTitle').textContent = `Job #${j.n} · ${sl}`;
  $('jdSub').textContent = `${w ? w.name : 'Any free worker'} · ${TIER_LABEL[j.tierApplied || j.tier]} model${j.simulated ? ' · simulated' : ''} · assigned ${ago(j.createdAt)}${j.retries ? ` · retry ${j.retries}` : ''}`;
  const wt = waitMs(j), th = j.startedAt ? (ttft(j) ?? runMs(j)) : 0, wr = j.firstTokenAt ? runMs(j) - ttft(j) : 0;
  const total = wt + th + wr || 1;
  $('jdStats').innerHTML = [['Queued', fmtDur(wt)], ['To first token', j.firstTokenAt ? fmtDur(ttft(j)) : j.status === 'running' ? '…' : '–'], ['Run time', j.startedAt ? fmtDur(runMs(j)) : '–'], ['≈ Tokens', `${fmtNum(j.inTok || 0)}→${fmtNum(j.outTok || 0)}`]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="val">${v}</div></div>`).join('');
  $('jdBar').innerHTML = `<span style="width:${wt / total * 100}%;background:var(--s-wait)"></span><span style="width:${th / total * 100}%;background:var(--s-think)"></span><span style="width:${wr / total * 100}%;background:${j.status === 'failed' ? 'var(--crit)' : 'var(--s-write)'}"></span>`;
  const speed = j.firstTokenAt && wr > 500 ? `<span>${Math.round((j.output || '').length / (wr / 1000))} chars/s</span>` : '';
  $('jdLegend').innerHTML = legendItems([['var(--s-wait)', 'queued', fmtDur(wt)], ['var(--s-think)', 'thinking', j.startedAt ? fmtDur(th) : '–'], ['var(--s-write)', 'writing', j.firstTokenAt ? fmtDur(wr) : '–']]) + speed;
  if ($('jdPrompt').textContent !== j.text) $('jdPrompt').textContent = j.text;
  paintOutput(); paintJobActions(); paintCode(j);
}
function paintOutput() {
  const j = jobById(selJob); if (!j) return;
  paintCode(j);
  const len = (j.output || '').length;
  if (paintedOut.id === j.id && paintedOut.len === len && paintedOut.status === j.status) return;
  const el = $('jdOutput'); const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  let html = j.output ? md(j.output) : `<p class="placeholder">${j.status === 'queued' ? 'Waiting for a free worker.' : j.status === 'running' ? 'Thinking…' : j.status === 'failed' ? 'No output.' : j.status === 'cancelled' ? 'Stopped before any output.' : ''}</p>`;
  if (j.status === 'failed') html += `<p class="placeholder" style="color:var(--crit)">${esc(ERROR_COPY[j.error] || 'The job failed.')} (${esc(j.error || 'error')})</p>${j.errorDetail ? `<pre class="files" style="white-space:pre-wrap">${esc(j.errorDetail)}</pre>` : ''}`;
  if (j.truncated) html += '<p class="placeholder">The answer hit the length limit and was cut short.</p>';
  el.innerHTML = html;
  if (stick && j.status === 'running') el.scrollTop = el.scrollHeight;
  paintedOut = { id: j.id, len, status: j.status };
}
// Coding jobs: branch, PR, files changed and live tool steps; PM jobs: proposed tickets.
const CAP_LABEL = { text: 'text', code: 'code', pm: 'PM', qa: 'QA' };
function diffHTML(d) {
  if (!d) return '';
  return `<span>${d.files.length} file${d.files.length === 1 ? '' : 's'} changed, <b style="color:var(--ok)">+${d.insertions}</b> <b style="color:var(--crit)">−${d.deletions}</b>, ${d.commits} commit${d.commits === 1 ? '' : 's'}</span>`;
}
function prHTML(j) {
  if (j.pr) return `<a class="pr" href="${esc(j.pr.url)}" target="_blank" rel="noreferrer">PR #${j.pr.number} into dev${j.pr.merged ? ' (merged)' : ''}</a>`;
  if (j.prError) return `<span style="color:var(--warn)">${esc(j.prError)}</span>`;
  return '';
}
function mergeHTML(j) {
  const m = j.merge; if (!m) return '';
  const c = m.check ? ` <code>${esc(m.check.cmd)}</code> ${m.check.ok ? `passed in ${fmtDur(m.check.ms)}` : 'failed'}` : '';
  if (m.status === 'merged') return `<span style="color:var(--ok)">Auto-merged into dev ·${c || ' merged'}</span>`;
  if (m.status === 'blocked') return `<span style="color:var(--warn)">Left open for you: ${esc(m.reason)}</span>`;
  return `<span>Auto-merge: checking…</span>`;
}
let paintedCode = '';
function paintCode(j) {
  const box = $('jdCode');
  if (!j || (j.kind !== 'code' && j.kind !== 'qa' && !(j.proposals && j.proposals.length))) { box.hidden = true; paintedCode = ''; return; }
  const sig = j.id + j.status + (j.merge ? j.merge.status : '') + (j.steps || []).length + (j.pr ? j.pr.url + j.pr.merged : '') + (j.prError || '') + JSON.stringify((j.proposals || []).map(x => x.accepted)) + (j.diff ? j.diff.insertions + '/' + j.diff.deletions : '');
  if (sig === paintedCode) return; paintedCode = sig;
  box.hidden = false;
  let h = '';
  if (j.kind === 'code' || j.kind === 'qa') {
    h += `<span class="label">${j.kind === 'qa' ? `QA${j.qa && j.qa.verdict ? ` · ${j.qa.verdict === 'pass' ? 'passed' : 'failed'}` : ''}` : 'Code'}</span><div class="legend"><span>${esc(j.branch || 'preparing a branch…')}</span>${diffHTML(j.diff)}</div>`;
    if (prHTML(j)) h += `<p style="margin:6px 0">${prHTML(j)}</p>`;
    if (j.merge) h += `<p style="margin:6px 0">${mergeHTML(j)}</p>${j.merge.check && j.merge.check.output && !j.merge.check.ok ? `<pre class="files" style="white-space:pre-wrap">${esc(j.merge.check.output.slice(-1500))}</pre>` : ''}`;
    if (j.diff && j.diff.files.length) h += `<ul class="files">${j.diff.files.map(f => `<li>${esc(f.file)} <b>+${f.add}</b> <i>−${f.del}</i></li>`).join('')}</ul>`;
    if ((j.steps || []).length) h += `<span class="label" style="margin-top:8px">Steps</span><ul class="steps">${j.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  if (j.proposals && j.proposals.length) {
    const open = j.proposals.some(x => !x.accepted);
    h += `<span class="label" style="margin-top:8px">Proposed tickets</span><div class="proposals">${j.proposals.map((x, i) => `<label><input type="checkbox" data-prop="${i}" ${x.accepted ? 'checked disabled' : 'checked'}><span><b>${esc(x.title)}</b> <span class="lbl">${esc(x.priority)}</span>${x.accepted ? ` <span class="lbl">added as ${esc(x.accepted)}</span>` : ''}<small>${esc(x.desc)}</small></span></label>`).join('')}</div>${open ? '<div class="actions"><button class="btn small primary" type="button" data-act="accept-props">Add selected to Backlog</button></div>' : ''}`;
  }
  box.innerHTML = h;
  const st = box.querySelector('.steps'); if (st) st.scrollTop = st.scrollHeight;
}
$('jdCode').addEventListener('click', async e => {
  if (!e.target.closest('[data-act="accept-props"]')) return;
  const j = jobById(selJob); if (!j) return;
  const picks = [...$('jdCode').querySelectorAll('input[data-prop]:checked:not(:disabled)')].map(i => +i.dataset.prop);
  if (!picks.length) { toast('Pick at least one ticket.'); return; }
  try { const added = await api.acceptProposals(j.id, picks); toast(`Added ${added.join(', ')} to the Backlog.`); }
  catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
});
$('stopAllBtn').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm: stop all', async () => { const n = await api.stopAll(); toast(n ? `Stopping ${n} job${n === 1 ? '' : 's'}.` : 'Nothing is running.'); }));
let paintedAct = null;
function paintJobActions() {
  const j = jobById(selJob); if (!j) return;
  const key = j.id + j.status + (j.output ? 1 : 0); if (paintedAct === key) return; paintedAct = key;
  const b = [];
  if (j.output) b.push('<button class="btn primary small" type="button" data-act="copy">Copy output</button>');
  if (isActive(j)) b.push(`<button class="btn small" type="button" data-act="stop">${j.status === 'queued' ? 'Cancel' : 'Stop'}</button>`);
  else b.push(`<button class="btn small" type="button" data-act="retry">${j.status === 'failed' ? 'Retry' : 'Run again'}</button>`, '<button class="btn small danger" type="button" data-act="delete">Delete</button>');
  $('jdActions').innerHTML = b.join('');
}
function renderWorkers() {
  $('workerTable').innerHTML = `<table><thead><tr><th>Worker</th><th>Now</th><th class="num">Jobs</th><th class="num">Success</th><th class="num">p50</th><th class="num">≈ Tok out</th><th class="num">Busy 1h</th></tr></thead><tbody>${workers.map(w => {
    const s = workerStats(w), [st, sc] = workerStatus(w);
    return `<tr data-id="${w.id}" class="${w.id === selWorker ? 'sel' : ''}"><td><div class="pet"><img src="${avatar(w.species)}" alt=""><div><b>${esc(w.name)}</b><span>${CAP_LABEL[w.capability] || 'text'} · ${esc((w.specialty || '').split(/[.\n]/)[0])}</span></div></div></td>
      <td><span class="pill" style="--c:${sc}">${st}</span></td><td class="num">${s.total}</td>
      <td class="num" style="${s.succ != null && s.succ < 0.8 ? 'color:var(--crit)' : ''}">${s.succ == null ? '–' : (s.succ * 100).toFixed(0) + '%'}</td>
      <td class="num">${s.p50 == null ? '–' : fmtDur(s.p50)}</td><td class="num">${fmtNum(s.out)}</td><td class="num">${(s.util * 100).toFixed(0)}%</td></tr>`;
  }).join('')}</tbody></table>`;
  $('hireBtn').disabled = workers.length >= MAX_WORKERS;
  paintWorkerDetail(false);
}
let formFor = null, retireArmed = false, retireT = 0;
function paintWorkerDetail(force) {
  const w = byWorker(selWorker), box = $('workerDetail');
  if (!w) { box.hidden = true; formFor = null; return; }
  box.hidden = false;
  const s = workerStats(w), [st] = workerStatus(w), v = V(w), j = v.jobId ? jobById(v.jobId) : null;
  $('wdAvatar').src = avatar(w.species);
  $('wdTitle').textContent = w.name;
  $('wdSub').textContent = `${w.species} · ${st}${j ? ` on job #${j.n}` : ''}`;
  $('wdStats').innerHTML = [['Shipped', s.ok], ['Failed', s.failed], ['Run p50', s.p50 == null ? '–' : fmtDur(s.p50)], ['Run p95', s.p95 == null ? '–' : fmtDur(s.p95)], ['≈ Tok in', fmtNum(s.tin)], ['≈ Tok out', fmtNum(s.out)], ['Busy 1h', (s.util * 100).toFixed(0) + '%'], ['Queued for', jobs.filter(q => q.status === 'queued' && q.pref === w.id).length]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="val">${v}</div></div>`).join('');
  if (force || formFor !== w.id) {
    formFor = w.id;
    $('wdName').value = w.name; $('wdSpecies').value = w.species; $('wdSpec').value = w.specialty || ''; $('wdCap').value = w.capability || 'text';
    retireArmed = false; $('retireBtn').textContent = 'Retire';
  }
}
function renderHeader() {
  const running = jobs.filter(j => j.status === 'running').length, queued = jobs.filter(j => j.status === 'queued').length;
  $('shift').textContent = ready ? `${workers.length} on shift · ${running} running · ${queued} queued` : 'opening the factory…';
  $('jobCount').textContent = jobs.length; $('workerCount').textContent = workers.length;
  $('lines').textContent = `${running} of ${concurrency} lines busy`;
  $('lines').className = 'mode' + (running ? ' live' : '');
}
function renderDash() {
  renderHeader();
  if (holdRender) return;
  if (tab === 'overview') renderOverview(); else if (tab === 'jobs') renderJobs(); else renderWorkers();
}
function setTab(t) {
  tab = t; lsSet('burrowby.works.tab', t);
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  for (const k of ['overview', 'jobs', 'workers']) $(`p-${k}`).hidden = k !== t;
  renderDash();
}
function syncWorkerSelect() {
  const sel = $('jobWorker'), cur = sel.value;
  sel.innerHTML = `<option value="any">Any free worker</option>` + workers.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'any';
}
function syncMode() {
  const m = $('mode');
  if (!ready) { m.textContent = 'Connecting…'; m.className = 'mode'; return; }
  if (sampleFn) { m.textContent = 'Working with Claude'; m.className = 'mode live'; m.title = cliInfo.message + ' Jobs are saved on this PC.'; }
  else { m.textContent = 'Claude Code not ready'; m.className = 'mode sim'; m.title = cliInfo.message + ' Click to open Settings.'; }
}

// ---------- interactions ----------
$('assign').addEventListener('submit', async e => {
  e.preventDefault();
  if (!ready) return;
  const text = $('jobText').value.trim();
  if (!text) { $('jobText').focus(); toast('Describe the job first.'); return; }
  const p = projectById($('jobProject').value);
  $('jobText').value = '';
  const j = await createJob(text.slice(0, 8000), $('jobWorker').value, $('jobTier').value, p ? { projectId: p.id, ctx: (p.ctx || []).filter(ctxById) } : {});
  openJob(j.id);
});
$('jobText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('assign').requestSubmit(); } });
$('examples').innerHTML = EXAMPLES.map((x, i) => `<button class="chip" type="button" data-ex="${i}">${esc(x)}</button>`).join('');
$('examples').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { $('jobText').value = EXAMPLES[+b.dataset.ex]; $('jobText').focus(); } });
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
$('concSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-c]'); if (!b) return;
  concurrency = +b.dataset.c; syncConc(); store.saveFactory(); renderDash();
});
$('concNum').addEventListener('change', e => {
  const n = Math.round(+e.target.value);
  if (n >= 1 && n <= 12) { concurrency = n; store.saveFactory(); renderDash(); }
  syncConc();
});
function syncConc() {
  for (const x of document.querySelectorAll('#concSeg button')) x.setAttribute('aria-pressed', String(+x.dataset.c === concurrency));
  $('concNum').value = concurrency;
  $('concNote').hidden = concurrency < 6;
}
document.querySelector('.obs').addEventListener('pointerdown', () => { holdRender = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { holdRender = false; }, 60); });
function openJob(id) { selJob = id; paintedAct = null; paintedOut.id = null; holdRender = false; if (tab !== 'jobs') setTab('jobs'); else renderJobs(); }
function openWorker(id) { selWorker = id; holdRender = false; if (tab !== 'workers') setTab('workers'); else renderWorkers(); }
$('jobList').addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (r) openJob(r.dataset.id); });
$('jobList').addEventListener('keydown', e => { const r = e.target.closest('[data-id]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openJob(r.dataset.id); } });
$('jobFilters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return; jobFilter = b.dataset.f;
  for (const x of document.querySelectorAll('#jobFilters [data-f]')) x.setAttribute('aria-pressed', String(x === b));
  holdRender = false; renderJobs();
});
$('jobDetail').addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const j = jobById(selJob);
  if (a.dataset.act === 'close-job') { selJob = null; holdRender = false; renderJobs(); return; }
  if (!j) return;
  if (a.dataset.act === 'copy') {
    try { await navigator.clipboard.writeText(j.output); toast('Copied the output.'); }
    catch { const r = document.createRange(); r.selectNodeContents($('jdOutput')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected the output. Press Ctrl+C to copy.'); }
    return;
  } else if (a.dataset.act === 'stop') {
    mergeJob(await api.stopJob(j.id));
  } else if (a.dataset.act === 'retry') {
    const n = mergeJob(await api.retryJob(j.id)); openJob(n.id); return;
  } else if (a.dataset.act === 'delete') {
    jobs = jobs.filter(x => x !== j); store.deleteJob(j); selJob = null;
  }
  paintedAct = null; holdRender = false; renderJobs();
});
$('clearBtn').addEventListener('click', () => {
  const gone = jobs.filter(j => !isActive(j));
  if (!gone.length) { toast('Nothing finished to clear.'); return; }
  jobs = jobs.filter(isActive); api.clearFinished();
  if (selJob && !jobById(selJob)) selJob = null;
  toast(`Cleared ${gone.length} finished job${gone.length > 1 ? 's' : ''}. Their metrics are gone too.`);
  holdRender = false; renderJobs();
});
$('workerTable').addEventListener('click', e => { const r = e.target.closest('tr[data-id]'); if (r) openWorker(r.dataset.id); });
$('workerDetail').addEventListener('click', e => { if (e.target.closest('[data-act="close-worker"]')) { selWorker = null; holdRender = false; renderWorkers(); } });
$('wdSpecies').innerHTML = Object.keys(SPECIES).map(s => `<option value="${s}">${s}</option>`).join('');
$('wdForm').addEventListener('submit', e => {
  e.preventDefault();
  const w = byWorker(selWorker); if (!w) return;
  const name = $('wdName').value.trim().slice(0, 20);
  if (!name) { toast('Give the worker a name.'); return; }
  w.name = name; w.species = $('wdSpecies').value; w.specialty = $('wdSpec').value.trim().slice(0, 1200); w.capability = $('wdCap').value;
  store.saveFactory(); syncWorkerSelect(); toast(`Saved ${w.name}.`);
  holdRender = false; paintWorkerDetail(true); renderWorkers();
});
$('retireBtn').addEventListener('click', () => {
  const w = byWorker(selWorker); if (!w) return;
  if (!workerFree(w) || jobs.some(j => j.status === 'running' && j.workerId === w.id)) { toast(`${w.name} is mid-job. Wait until they're back at their bench.`); return; }
  if (workers.length <= 1) { toast('The factory needs at least one worker.'); return; }
  if (!retireArmed) { retireArmed = true; $('retireBtn').textContent = `Confirm: retire ${w.name}`; clearTimeout(retireT); retireT = setTimeout(() => { retireArmed = false; $('retireBtn').textContent = 'Retire'; }, 4000); return; }
  api.retireWorker(w.id).then(r => { if (!r.ok) toast(r.error); });
  workers = workers.filter(x => x !== w); vis.delete(w.id); selWorker = null;
  layout(); syncWorkerSelect(); toast(`${w.name} retired. Their queued jobs go to any free worker.`);
  holdRender = false; renderWorkers();
});
$('hireBtn').addEventListener('click', () => {
  if (workers.length >= MAX_WORKERS) return;
  const used = new Set(workers.map(w => w.name));
  const w = { id: uid('w_'), name: pick(NAMES.filter(n => !used.has(n))) || 'Newbie', species: pick(Object.keys(SPECIES)), specialty: 'Generalist. Handles any job carefully and concisely.' };
  workers.push(w); layout();
  const st = stationOf(w), v = V(w); v.x = CORR_L; v.y = st.aisle; v.emote = { kind: 'heart', t: 2, max: 2 };
  store.saveFactory(); syncWorkerSelect(); openWorker(w.id); paintWorkerDetail(true);
  toast(`${w.name} joined the crew. Give them a specialty below.`);
  setTimeout(() => $('wdSpec').focus(), 50);
});
function worldPt(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
function hit(p) {
  for (const w of workers) { const v = V(w); if (Math.hypot(v.x - p.x, v.y - 14 - p.y) < 22) return { worker: w }; }
  for (const w of workers) { const st = stationOf(w); if (st && Math.abs(p.x - st.x) < 70 && p.y > st.y - 50 && p.y < st.y + 38) return { worker: w, station: true }; }
  const crates = intakeCrates().slice(0, 9);
  for (let i = 0; i < crates.length; i++) { const s = crateSlot(i); if (Math.abs(p.x - s.x) < 18 && Math.abs(p.y - s.y) < 16) return { job: crates[i] }; }
  return null;
}
canvas.addEventListener('pointermove', e => { const h = hit(worldPt(e)); hoverId = h && h.worker ? h.worker.id : null; canvas.style.cursor = h ? 'pointer' : 'default'; });
canvas.addEventListener('pointerleave', () => { hoverId = null; });
canvas.addEventListener('click', e => {
  const h = hit(worldPt(e)); if (!h) return;
  if (h.job) { openJob(h.job.id); return; }
  const v = V(h.worker);
  if (h.station && v.jobId && v.state === 'working') { openJob(v.jobId); return; }
  v.emote = { kind: 'heart', t: 1.2, max: 1.2 }; openWorker(h.worker.id);
});

// ---------- projects, board, context library ----------
const COLS = [['backlog', 'Backlog'], ['todo', 'To do'], ['progress', 'In progress'], ['testing', 'Testing'], ['review', 'Review'], ['done', 'Done']];
const PRIO = { low: ['Low', 'var(--s-wait)'], med: ['Medium', 'var(--s-walk)'], high: ['High', 'var(--warn)'], urgent: ['Urgent', 'var(--crit)'] };
const KINDS = { note: 'Note', doc: 'Reference doc', data: 'Data', style: 'Style guide', snippet: 'Snippet' };
const COLORS = ['#DC5434', '#3E8FB0', '#2C8C58', '#8E6BD6', '#D99A1E', '#C2497F'];
const tok = s => Math.round((s || '').length / 4);
const projectById = id => projects.find(p => p.id === id);
const taskById = id => tasks.find(t => t.id === id);
const ctxById = id => contexts.find(c => c.id === id);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lastJob = t => { const ids = t.jobs || []; for (let i = ids.length - 1; i >= 0; i--) { const j = jobById(ids[i]); if (j) return j; } return null; };
const keyFrom = name => { const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); const k = words.length > 1 ? words.map(w => w[0]).join('').slice(0, 4) : (words[0] || 'PRJ').slice(0, 3); return k.toUpperCase(); };
function taskKey(t) { const p = projectById(t.projectId); return `${p ? p.key : 'TASK'}-${t.n}`; }
function saveProject(p) { p.updatedAt = Date.now(); store.saveDoc('projects', p); }
function saveTask(t) { t.updatedAt = Date.now(); store.saveDoc('tasks', t); }
function saveCtx(c) { c.updatedAt = Date.now(); store.saveDoc('context', c); }
function confirmClick(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
  const orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = orig; } }, 4000);
}

let view = lsGet('burrowby.view') || 'factory';
let curProject = lsGet('burrowby.project') || null;
let boardQuery = '', dragging = false, editingTask = null, taskIsNew = false, editingProject = null, suggestions = null, selCtx = null, projColor = COLORS[0];

function setView(v) {
  if (!['assistant', 'factory', 'board', 'context'].includes(v)) v = 'factory';
  view = v; lsSet('burrowby.view', v);
  for (const b of document.querySelectorAll('.views button')) b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false');
  for (const k of ['assistant', 'factory', 'board', 'context']) $('view-' + k).hidden = k !== v;
  $('factoryControls').classList.toggle('off', v !== 'factory');
  if (v !== 'board') { $('taskDrawer').hidden = true; $('projDrawer').hidden = true; }
  if (v === 'board') renderBoard(); else if (v === 'context') renderContext(); else if (v === 'assistant') paintChatNow();
}
document.querySelector('.views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
function syncProjectSelect() {
  const sel = $('jobProject'), cur = sel.value;
  sel.innerHTML = '<option value="">No project</option>' + projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
}

// --- data operations
function makeProject(o) {
  const p = { id: uid('p_'), name: o.name, key: o.key, color: o.color || COLORS[projects.length % COLORS.length], desc: o.desc || '', ctx: o.ctx || [], seq: 0, createdAt: Date.now() };
  projects.push(p); saveProject(p); return p;
}
function makeTask(p, o) {
  p.seq = Math.max(p.seq || 0, ...tasks.filter(t => t.projectId === p.id).map(t => t.n || 0)) + 1; saveProject(p);
  const t = { id: uid('t_'), projectId: p.id, n: p.seq, title: o.title, desc: o.desc || '', status: o.status || 'todo', priority: o.priority || 'med', assignee: o.assignee || '', labels: o.labels || [], due: o.due || '', ctx: o.ctx || [], jobs: [], order: Date.now() + Math.random(), createdAt: Date.now() };
  tasks.push(t); saveTask(t); return t;
}
async function sendTask(t) {
  const j = mergeJob(await api.sendTask(t.id));
  toast(`${taskKey(t)} is on the intake belt as job #${j.n}.`);
  return j;
}
function onJobFinished(j) {
  const t = j.taskId && taskById(j.taskId); if (!t) return;
  if (view === 'board' && !dragging) renderCols();
  if (editingTask === t) paintTaskRuns(true);
}
async function sampleProject() {
  const p = await api.sampleProject();
  curProject = p.id; lsSet('burrowby.project', p.id); syncProjectSelect(); renderBoard();
  toast('Added a sample project. Open a task and send it to the factory.');
}

// --- board rendering
function renderProjects() {
  $('projList').innerHTML = projects.length ? projects.map(p => {
    const open = tasks.filter(t => t.projectId === p.id && t.status !== 'done').length;
    return `<button class="proj" type="button" data-proj="${p.id}" aria-current="${p.id === curProject}"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}</span><span class="k" title="Open tasks">${open}</span></button>`;
  }).join('') : '<div class="empty">No projects yet.</div>';
}
function renderBoard() {
  if (!projectById(curProject)) curProject = projects[0] ? projects[0].id : null;
  renderProjects();
  const p = projectById(curProject);
  $('boardEmpty').hidden = !!p; $('boardMain').hidden = !p;
  if (!p) return;
  $('bhDot').style.background = p.color; $('bhName').textContent = p.name; $('bhKey').textContent = p.key;
  $('bhDesc').textContent = p.desc || 'No description yet. Edit the project to add one and attach context your workers should know.';
  const pc = (p.ctx || []).map(ctxById).filter(Boolean);
  $('bhCtx').textContent = pc.length ? `· ${pc.length} context entr${pc.length > 1 ? 'ies' : 'y'}, ≈${fmtNum(pc.reduce((s, c) => s + tok(c.content), 0))} tok per task` : '· no project context';
  const note = $('bhRepo'), r = p.repo;
  note.hidden = !r;
  if (r) note.textContent = r.status === 'ready'
    ? `Repo ${r.url}${r.github ? '' : ' (not on GitHub: no PRs)'} · Coders edit only in git worktrees under ${repoRoot}\\worktrees\\${p.key} on feature/${p.key}-* branches cut from dev · ${p.autoMerge !== false ? `Auto-merge on: worker PRs merge into dev when ${p.checkCmd ? p.checkCmd : 'the project check (npm run check / npm test)'} passes` : 'Auto-merge off: worker PRs wait for you'} · only you release dev → prod.`
    : r.status === 'setting-up' ? `Setting up the repository from ${r.source}…` : `Repository problem: ${r.error}`;
  $('releaseBtn').hidden = !(r && r.status === 'ready');
  paintRelease(p);
  renderSuggest(); renderCols();
}
// BWI-37: PM auto-pull indicator and toggle (off by default).
let autoPull = false;
function paintAutoPull() {
  const b = $('autoPullBtn'); if (!b) return;
  b.textContent = autoPull ? 'PM auto-pull: On' : 'PM auto-pull: Off';
  b.setAttribute('aria-pressed', String(autoPull));
  b.classList.toggle('primary', autoPull);
}
$('autoPullBtn').addEventListener('click', () => { autoPull = !autoPull; paintAutoPull(); api.setFactory({ autoPull }); });
paintAutoPull();
let repoRoot = '%USERPROFILE%\\Burrowby';
api.repoInfo().then(i => { repoRoot = i.root; if (view === 'board') renderBoard(); }).catch(() => {});
// Release status: what "Release to prod" would ship, from freshly fetched refs
// (refreshed at most every 60 s, and right after a release), plus the last release.
const releaseInfo = new Map(); // project id -> { at, preview | error }
function paintRelease(p) {
  const el = $('bhRelease'), btn = $('releaseBtn'), r = p.repo;
  if (!r || r.status !== 'ready') { el.hidden = true; return; }
  const info = releaseInfo.get(p.id);
  if (!info || Date.now() - info.at > 60e3) refreshRelease(p.id);
  const last = p.lastRelease ? ` · Last release ${esc(p.lastRelease.from)} → ${esc(p.lastRelease.sha)}${p.lastRelease.prs && p.lastRelease.prs.length ? ` (${p.lastRelease.prs.map(n => `#${n}`).join(', ')})` : ''}, ${ago(p.lastRelease.at)}` : '';
  const pv = info && info.preview;
  el.hidden = false;
  el.innerHTML = (info && info.error ? `Couldn't check what would ship: ${esc(info.error)}` : pv ? esc(pv.summary) : 'Checking what would ship…') + last;
  btn.textContent = pv && pv.ahead && !pv.diverged ? `Release to prod (${pv.ahead})` : 'Release to prod';
  btn.disabled = !!(pv && (!pv.ahead || pv.diverged));
  btn.title = pv ? pv.summary : 'Fast-forward prod to dev. Only you can do this.';
}
async function refreshRelease(id) {
  releaseInfo.set(id, { ...(releaseInfo.get(id) || {}), at: Date.now() });
  const res = await api.releasePreview(id);
  releaseInfo.set(id, res.ok ? { at: Date.now(), preview: res.result } : { at: Date.now(), error: res.error });
  const p = projectById(id);
  if (p && view === 'board' && curProject === id) paintRelease(p);
}
$('releaseBtn').addEventListener('click', async () => {
  const p = projectById(curProject); if (!p) return;
  const btn = $('releaseBtn'); btn.disabled = true;
  const r = await api.releaseToProd(p.id); btn.disabled = false;
  if (!r.ok) toast(r.error);
  else toast(r.result.released ? `Released ${r.result.commits} commit${r.result.commits === 1 ? '' : 's'} to prod: ${r.result.from} → ${r.result.sha}${r.result.prs && r.result.prs.length ? ` (${r.result.prs.map(n => `#${n}`).join(', ')})` : ''}.` : r.result.note);
  releaseInfo.delete(p.id); paintRelease(projectById(p.id));
});
function card(t) {
  const w = byWorker(t.assignee), j = lastJob(t);
  const late = t.due && t.status !== 'done' && t.due < todayStr();
  let jp = '';
  if (j && isActive(j)) jp = `<span class="pill" style="--c:${j.status === 'queued' ? 'var(--s-wait)' : j.firstTokenAt ? 'var(--s-write)' : 'var(--s-think)'}">${j.status === 'queued' ? 'queued' : j.firstTokenAt ? 'writing' : 'thinking'} #${j.n}</span>`;
  else if (j && j.status === 'failed' && t.status !== 'done') jp = `<span class="pill" style="--c:var(--crit)">run failed</span>`;
  const nCtx = (t.ctx || []).length;
  return `<div class="tcard" draggable="true" data-task="${t.id}" role="button" tabindex="0" style="--pc:${PRIO[t.priority] ? PRIO[t.priority][1] : 'var(--s-walk)'}">
    <span class="tk">${esc(taskKey(t))} · ${PRIO[t.priority] ? PRIO[t.priority][0] : 'Medium'}</span>
    <span class="tt">${esc(t.title)}</span>
    <span class="tf">${(t.labels || []).map(l => `<span class="lbl">${esc(l)}</span>`).join('')}${t.due ? `<span class="lbl ${late ? 'late' : ''}">${late ? 'overdue ' : 'due '}${esc(t.due.slice(5))}</span>` : ''}${nCtx ? `<span class="lbl">${nCtx} ctx</span>` : ''}${jp}${w ? `<img src="${avatar(w.species)}" alt="${esc(w.name)}" title="${esc(w.name)}">` : ''}</span>
  </div>`;
}
function renderCols() {
  const p = projectById(curProject); if (!p) return;
  const q = boardQuery.toLowerCase();
  const ts = tasks.filter(t => t.projectId === p.id && (!q || `${taskKey(t)} ${t.title} ${t.desc || ''} ${(t.labels || []).join(' ')}`.toLowerCase().includes(q)));
  $('cols').innerHTML = COLS.map(([k, l]) => {
    const list = ts.filter(t => t.status === k).sort((a, b) => (a.order || 0) - (b.order || 0));
    return `<div class="col" data-col="${k}"><div class="col-h"><span>${l}</span><b>${list.length}</b></div><div class="col-body">${list.map(card).join('')}${k === 'backlog' || k === 'todo' ? `<button class="addcard" type="button" data-add="${k}">+ Add task</button>` : ''}</div></div>`;
  }).join('');
}
function renderSuggest() {
  const box = $('suggest');
  if (!suggestions || suggestions.pid !== curProject) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="section-h"><h3>Suggested tasks</h3><span class="sub">pick the ones to add</span></div>` +
    suggestions.items.map((s, i) => `<label><input type="checkbox" data-sug="${i}" ${s.pick ? 'checked' : ''}><span><b>${esc(s.title)}</b> <span class="lbl">${PRIO[s.priority][0]}</span><small>${esc(s.desc)}</small></span></label>`).join('') +
    `<div class="actions"><button class="btn primary small" type="button" data-act="add-sug">Add selected to Backlog</button><button class="btn small" type="button" data-act="dismiss-sug">Dismiss</button></div>`;
}
async function suggestTasks() {
  const p = projectById(curProject); if (!p) return;
  if (!sampleFn) { toast('Suggesting tasks needs Claude Code. Open Settings to set it up.'); return; }
  const btn = $('suggestBtn'); btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const items = await api.suggestTasks(p.id);
    if (!items.length) toast('No suggestions came back. Add a project description and try again.');
    else { suggestions = { pid: p.id, items }; renderSuggest(); }
  } catch (e) {
    toast(String(e && e.message || 'Could not get suggestions. Try again.').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  } finally { btn.disabled = false; btn.textContent = 'Suggest tasks'; }
}

// --- task drawer
function selOpts(list, cur) { return list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join(''); }
function openTask(t, isNew) {
  editingTask = t; taskIsNew = isNew;
  const p = projectById(t.projectId);
  $('tdKey').textContent = isNew ? `${p.key} · new task` : `${taskKey(t)} · ${p.name}`;
  $('tdHead').textContent = isNew ? 'New task' : t.title;
  $('tdTitle').value = t.title || ''; $('tdDesc').value = t.desc || '';
  $('tdStatus').innerHTML = selOpts(COLS, t.status || 'todo');
  $('tdPrio').innerHTML = selOpts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), t.priority || 'med');
  $('tdAssignee').innerHTML = selOpts([['', 'Any free worker'], ...workers.map(w => [w.id, w.name])], t.assignee || '');
  $('tdDue').value = t.due || ''; $('tdLabels').value = (t.labels || []).join(', ');
  paintTaskCtx(); paintQa(); $('tdDelete').hidden = isNew;
  paintTaskRuns(true);
  $('projDrawer').hidden = true; $('taskDrawer').hidden = false;
  if (isNew) setTimeout(() => $('tdTitle').focus(), 30);
}
// --- acceptance-criteria QA gate: criteria come from the "Acceptance:" part of the description
function parseCriteria(desc) {
  const out = []; let on = false;
  for (const line of String(desc || '').split('\n')) {
    const m = line.match(/^\s*(?:#+\s*)?acceptance(?:\s+criteria)?\s*:?\s*(.*)$/i);
    if (m) { on = true; for (const s of m[1].split(';')) if (s.trim()) out.push(s.trim().replace(/\.$/, '')); continue; }
    if (!on) continue;
    const b = line.match(/^\s*(?:[-*]|\d+[.)])\s*(?:\[[ xX]?\]\s*)?(.+)$/);
    if (b) out.push(b[1].trim()); else if (line.trim()) on = false;
  }
  return out.slice(0, 20);
}
function qaItems(t, desc) {
  const old = (t.acceptance && t.acceptance.items) || [];
  return parseCriteria(desc).map(text => old.find(i => i.text === text) || { text, result: '', note: '' });
}
function canFinish(t, desc) {
  const items = qaItems(t, desc);
  return !items.length || !!(t.acceptance && t.acceptance.override) || items.every(i => i.result === 'pass');
}
function paintQa() {
  const t = editingTask, box = $('tdQa'), items = t && !taskIsNew ? qaItems(t, $('tdDesc').value) : [];
  box.hidden = !items.length;
  const st = $('tdStatus');
  if (items.length) {
    const ov = !!(t.acceptance && t.acceptance.override), pass = items.filter(i => i.result === 'pass').length;
    box.innerHTML = `<span class="label">QA checklist</span>` + items.map((i, n) => `<div class="qa-row"><span>${esc(i.text)}</span><span class="seg"><button type="button" class="pass" data-qa="${n}" data-r="pass" aria-pressed="${i.result === 'pass'}">Pass</button><button type="button" class="fail" data-qa="${n}" data-r="fail" aria-pressed="${i.result === 'fail'}">Fail</button></span><input type="text" data-note="${n}" maxlength="300" placeholder="Note" aria-label="Note for criterion ${n + 1}" value="${esc(i.note || '')}"></div>`).join('') +
      `<div class="qa-sum">${pass}/${items.length} pass${t.acceptance && t.acceptance.checkedAt ? ` · checked ${ago(t.acceptance.checkedAt)}` : ''}</div>` +
      `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" data-ov style="width:auto" ${ov ? 'checked' : ''}> Owner override: allow Done without all passing</label>`;
  }
  const ok = canFinish(t || {}, $('tdDesc').value);
  for (const o of st.options) if (o.value === 'done') { o.disabled = !ok && t && !taskIsNew; o.textContent = o.disabled ? 'Done (needs QA pass)' : 'Done'; }
}
function saveQa(mut) {
  const t = editingTask; if (!t || taskIsNew) return;
  const items = qaItems(t, $('tdDesc').value);
  t.acceptance = { items, override: !!(t.acceptance && t.acceptance.override), checkedAt: Date.now() };
  mut(t.acceptance); saveTask(t); paintQa();
}
$('tdQa').addEventListener('click', e => {
  const b = e.target.closest('[data-qa]'); if (!b) return;
  saveQa(a => { const i = a.items[+b.dataset.qa]; i.result = i.result === b.dataset.r ? '' : b.dataset.r; });
});
$('tdQa').addEventListener('change', e => {
  if (e.target.matches('[data-ov]')) saveQa(a => { a.override = e.target.checked; a.overrideAt = a.override ? Date.now() : 0; });
  else if (e.target.matches('[data-note]')) saveQa(a => { a.items[+e.target.dataset.note].note = e.target.value.trim().slice(0, 300); });
});
$('tdDesc').addEventListener('input', paintQa);
function paintTaskCtx() {
  const t = editingTask, p = projectById(t.projectId), pc = new Set(p ? p.ctx || [] : []);
  $('tdCtx').innerHTML = contexts.length ? contexts.map(c => `<label><input type="checkbox" data-c="${c.id}" ${pc.has(c.id) || (t.ctx || []).includes(c.id) ? 'checked' : ''} ${pc.has(c.id) ? 'disabled' : ''}> ${esc(c.title || 'Untitled')}${pc.has(c.id) ? ' <em style="color:var(--muted);font-style:normal">(project)</em>' : ''}<span>≈${fmtNum(tok(c.content))}</span></label>`).join('') : '<div class="empty">No context yet. Add entries in the Context library.</div>';
  paintCtxNote();
}
function paintCtxNote() {
  const ids = [...$('tdCtx').querySelectorAll('input[data-c]:checked')].map(i => i.dataset.c);
  const n = ids.map(ctxById).filter(Boolean).reduce((s, c) => s + tok(c.content), 0);
  $('tdCtxNote').textContent = ids.length ? `≈${fmtNum(n)} tokens sent with this task` : 'none attached';
}
let runsSig = '';
function paintTaskRuns(force) {
  const t = editingTask; if (!t) return;
  if (taskIsNew) { $('tdRuns').innerHTML = ''; $('tdAudit').innerHTML = ''; runsSig = ''; return; }
  const js = (t.jobs || []).map(jobById).filter(Boolean).reverse();
  const sig = (t.audit || []).length + '@' + js.map(j => j.id + j.status + (j.merge ? j.merge.status : '') + (j.output || '').length + (j.pr ? j.pr.url + j.pr.merged : '') + (j.prError || '') + (j.steps || []).length).join('|') + '#' + (t.qa || []).length;
  if (!force && sig === runsSig) return; runsSig = sig;
  const qaHTML = (t.qa || []).length ? `<span class="label">QA notes</span>` + [...t.qa].reverse().map(q => `<div class="output"><b>${q.verdict === 'pass' ? 'Passed' : q.verdict === 'fail' ? 'Failed' : 'Not finished'}</b> · ${esc(q.by || 'QA')} · job #${q.n}${q.verdict === 'fail' && q.coder ? ` · back to ${esc(q.coder)}` : ''}<br>${md(q.notes || '')}</div>`).join('') : '';
  const events = [...(t.audit || [])].reverse().sort((a, b) => b.at - a.at); // newest first
  $('tdAudit').innerHTML = `<span class="label">Audit trail</span>` + (events.length
    ? `<div class="output">${events.map(a => `<div><b>${esc(a.type)}</b> · ${esc(a.actor)} · ${esc(new Date(a.at).toLocaleString())}<br>${esc(a.text)}</div>`).join('')}</div><div class="actions"><button class="btn" type="button" data-act="export-audit">Export as text</button></div>`
    : '<div class="empty">No events recorded yet.</div>');
  const latest = js.find(j => j.output);
  $('tdRuns').innerHTML = js.length ? qaHTML + `<span class="label">Factory runs</span><div class="joblist">${js.map(j => { const [sl, sc] = STATUS[j.status]; const w = byWorker(j.workerId || j.pref); return `<div class="job" data-job="${j.id}" role="button" tabindex="0"><img src="${avatar(w ? w.species : 'chick')}" alt=""><span class="txt">Job #${j.n} · ${w ? esc(w.name) : 'any worker'}</span><span class="pill" style="--c:${sc}">${sl}</span><span class="meta"><span>${j.startedAt ? fmtDur(runMs(j)) : 'waiting'}</span><span>≈${fmtNum(j.outTok || 0)} tok</span>${j.kind === 'code' && j.steps ? `<span>${j.steps.length} steps</span>` : ''}${j.diff ? `<span>+${j.diff.insertions} −${j.diff.deletions}</span>` : ''}<span>${ago(j.createdAt)}</span></span></div>${j.kind === 'code' || j.kind === 'qa' ? `<div class="legend" style="margin:2px 0 6px 40px">${j.branch ? `<span>${esc(j.branch)}</span>` : ''}${prHTML(j)}${j.merge ? `<span>${mergeHTML(j)}</span>` : ''}</div>` : ''}`; }).join('')}</div>` +
    (latest ? `<span class="label">Latest output · job #${latest.n}</span><div class="output">${md(latest.output)}</div>` : '') : '<div class="empty">Not sent to the factory yet.</div>';
}
function saveTaskForm() {
  const t = editingTask, p = t && projectById(t.projectId); if (!p) return null;
  const title = $('tdTitle').value.trim();
  if (!title) { toast('Give the task a title.'); $('tdTitle').focus(); return null; }
  const f = { title: title.slice(0, 140), desc: $('tdDesc').value.trim(), status: $('tdStatus').value, priority: $('tdPrio').value, assignee: $('tdAssignee').value, due: $('tdDue').value,
    labels: $('tdLabels').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8), ctx: [...$('tdCtx').querySelectorAll('input[data-c]:checked:not(:disabled)')].map(i => i.dataset.c) };
  if (f.status === 'done' && !taskIsNew && f.status !== t.status && !canFinish(t, f.desc)) { toast('Mark every acceptance criterion pass, or use the owner override, before Done.'); $('tdStatus').value = t.status; return null; }
  let real;
  if (taskIsNew) { real = makeTask(p, f); taskIsNew = false; editingTask = real; }
  else { if (f.status !== t.status) t.order = Date.now(); Object.assign(t, f); saveTask(t); real = t; }
  renderBoard();
  return real;
}
$('taskForm').addEventListener('submit', e => { e.preventDefault(); const t = saveTaskForm(); if (t) { toast(`Saved ${taskKey(t)}.`); openTask(t, false); } });
$('tdCtx').addEventListener('change', paintCtxNote);
$('taskDrawer').addEventListener('click', e => {
  const run = e.target.closest('[data-job]');
  if (run) { $('taskDrawer').hidden = true; setView('factory'); openJob(run.dataset.job); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'close') { $('taskDrawer').hidden = true; editingTask = null; return; }
  if (a.dataset.act === 'export-audit') { api.exportAudit(editingTask.id).then(r => { if (r && r.ok) toast('Audit trail exported.'); }); return; }
  if (a.dataset.act === 'send') { const t = saveTaskForm(); if (t) sendTask(t).then(() => { openTask(t, false); renderCols(); }); return; }
  if (a.dataset.act === 'delete') confirmClick(a, 'Confirm delete', () => {
    const t = editingTask; tasks = tasks.filter(x => x !== t); store.delDoc('tasks', t.id);
    $('taskDrawer').hidden = true; editingTask = null; renderBoard(); toast(`Deleted ${taskKey(t)}.`);
  });
});

// --- project drawer
function openProject(p) {
  editingProject = p || null;
  $('pdHead').textContent = p ? 'Edit project' : 'New project';
  $('pdName').value = p ? p.name : ''; $('pdKey').value = p ? p.key : ''; $('pdDesc').value = p ? p.desc || '' : '';
  projColor = p ? p.color : COLORS[projects.length % COLORS.length]; paintSwatches();
  const pc = new Set(p ? p.ctx || [] : []);
  $('pdCtx').innerHTML = contexts.length ? contexts.map(c => `<label><input type="checkbox" data-c="${c.id}" ${pc.has(c.id) ? 'checked' : ''}> ${esc(c.title || 'Untitled')}<span>≈${fmtNum(tok(c.content))}</span></label>`).join('') : '<div class="empty">No context yet. Add entries in the Context library, then attach them here.</div>';
  $('pdDelete').hidden = !p;
  $('pdRepo').value = p && p.repo ? p.repo.source : '';
  $('pdAuto').checked = !p || p.autoMerge !== false; $('pdCheck').value = (p && p.checkCmd) || '';
  paintRepoNote(p);
  $('taskDrawer').hidden = true; $('projDrawer').hidden = false;
  setTimeout(() => $('pdName').focus(), 30);
}
function paintRepoNote(p) {
  const r = p && p.repo;
  $('pdRepoNote').textContent = !p ? 'Save the project first, then connect a repository.'
    : !r ? `The app clones it to ${repoRoot}\\projects\\${p.key} and makes sure prod and dev branches exist. Coders then work in worktrees under ${repoRoot}\\worktrees\\${p.key}.`
    : r.status === 'ready' ? `Clone: ${r.path} · remote ${r.url}${r.github ? '' : ' (not GitHub: branches are pushed but no PRs are opened)'}`
    : r.status === 'setting-up' ? 'Setting up…' : `Problem: ${r.error}`;
}
function paintSwatches() { $('pdColor').innerHTML = COLORS.map(c => `<button type="button" data-color="${c}" aria-label="Color ${c}" aria-pressed="${c === projColor}" style="background:${c}"></button>`).join(''); }
$('pdColor').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { projColor = b.dataset.color; paintSwatches(); } });
$('projForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('pdName').value.trim(); if (!name) { toast('Name the project.'); return; }
  const key = $('pdKey').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || keyFrom(name);
  const ctx = [...$('pdCtx').querySelectorAll('input[data-c]:checked')].map(i => i.dataset.c);
  const desc = $('pdDesc').value.trim();
  const merging = { autoMerge: $('pdAuto').checked, checkCmd: $('pdCheck').value.trim().slice(0, 300) };
  if (editingProject) { Object.assign(editingProject, { name, key, desc, ctx, color: projColor }, merging); saveProject(editingProject); }
  else { const p = makeProject({ name, key, desc, ctx, color: projColor }); Object.assign(p, merging); saveProject(p); curProject = p.id; lsSet('burrowby.project', p.id); }
  $('projDrawer').hidden = true; syncProjectSelect(); renderBoard(); toast(`Saved ${name}.`);
});
$('projDrawer').addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'close') { $('projDrawer').hidden = true; return; }
  if (a.dataset.act === 'set-repo') {
    const p = editingProject; if (!p) { toast('Save the project first.'); return; }
    const src = $('pdRepo').value.trim(); if (!src && !(p.repo && p.repo.path)) { toast('Paste a GitHub URL or a local folder path.'); return; }
    a.disabled = true; a.textContent = 'Connecting…';
    api.setRepo(p.id, src).then(r => {
      a.disabled = false; a.textContent = 'Connect';
      if (r.ok) toast(`${p.key} repository ready${r.result.created_branches.length ? `; created ${r.result.created_branches.join(' and ')}` : ''}.`); else toast(r.error);
      paintRepoNote(projectById(p.id)); if (view === 'board') renderBoard();
    });
    return;
  }
  if (a.dataset.act === 'delete' && editingProject) {
    const p = editingProject, n = tasks.filter(t => t.projectId === p.id).length;
    confirmClick(a, `Confirm: delete it and ${n} task${n === 1 ? '' : 's'}`, () => {
      for (const t of tasks.filter(t => t.projectId === p.id)) store.delDoc('tasks', t.id);
      tasks = tasks.filter(t => t.projectId !== p.id); projects = projects.filter(x => x !== p); store.delDoc('projects', p.id);
      $('projDrawer').hidden = true; curProject = null; syncProjectSelect(); renderBoard(); toast(`Deleted ${p.name}.`);
    });
  }
});

// --- board interactions
$('view-board').addEventListener('click', e => {
  const pr = e.target.closest('[data-proj]');
  if (pr) { curProject = pr.dataset.proj; lsSet('burrowby.project', curProject); boardQuery = ''; $('boardSearch').value = ''; renderBoard(); return; }
  const add = e.target.closest('[data-add]');
  if (add) { openTask({ projectId: curProject, status: add.dataset.add, priority: 'med' }, true); return; }
  const tc = e.target.closest('[data-task]');
  if (tc) { const t = taskById(tc.dataset.task); if (t) openTask(t, false); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'new-project') openProject(null);
  else if (act === 'sample-project') sampleProject();
  else if (act === 'edit-project') openProject(projectById(curProject));
  else if (act === 'new-task') openTask({ projectId: curProject, status: 'todo', priority: 'med' }, true);
  else if (act === 'dismiss-sug') { suggestions = null; renderSuggest(); }
  else if (act === 'add-sug' && suggestions) {
    const p = projectById(suggestions.pid); const picks = suggestions.items.filter(s => s.pick);
    if (p) for (const s of picks) makeTask(p, { title: s.title, desc: s.desc, priority: s.priority, status: 'backlog', labels: ['suggested'] });
    suggestions = null; renderBoard(); toast(`Added ${picks.length} task${picks.length === 1 ? '' : 's'} to the Backlog.`);
  }
});
$('suggest').addEventListener('change', e => { const c = e.target.closest('[data-sug]'); if (c && suggestions) suggestions.items[+c.dataset.sug].pick = c.checked; });
$('suggestBtn').addEventListener('click', suggestTasks);
$('boardSearch').addEventListener('input', e => { boardQuery = e.target.value.trim(); renderCols(); });
$('cols').addEventListener('keydown', e => { const tc = e.target.closest('[data-task]'); if (tc && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const t = taskById(tc.dataset.task); if (t) openTask(t, false); } });
$('cols').addEventListener('dragstart', e => { const tc = e.target.closest('[data-task]'); if (!tc) return; dragging = true; tc.classList.add('dragging'); e.dataTransfer.setData('text/plain', tc.dataset.task); e.dataTransfer.effectAllowed = 'move'; });
$('cols').addEventListener('dragend', () => { dragging = false; for (const c of document.querySelectorAll('.col.over')) c.classList.remove('over'); renderCols(); });
$('cols').addEventListener('dragover', e => { const col = e.target.closest('[data-col]'); if (!col) return; e.preventDefault(); for (const c of document.querySelectorAll('.col.over')) if (c !== col) c.classList.remove('over'); col.classList.add('over'); });
$('cols').addEventListener('drop', e => {
  const col = e.target.closest('[data-col]'); if (!col) return; e.preventDefault();
  const t = taskById(e.dataTransfer.getData('text/plain')); dragging = false;
  if (t && col.dataset.col === 'done' && t.status !== 'done' && !canFinish(t, t.desc)) toast(`${taskKey(t)} needs every acceptance criterion passed (or an owner override) before Done. Open it to run the QA checklist.`);
  else if (t && t.status !== col.dataset.col) { t.status = col.dataset.col; t.order = Date.now(); saveTask(t); }
  renderBoard();
});

// --- context library
$('ctxKind').innerHTML = '<option value="">All types</option>' + Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
let ctxFormFor = null;
function renderContext() { renderCtxList(); renderCtxMain(); }
function renderCtxList() {
  const q = $('ctxSearch').value.trim().toLowerCase(), k = $('ctxKind').value;
  const list = contexts.filter(c => (!k || c.kind === k) && (!q || `${c.title} ${(c.tags || []).join(' ')} ${c.content}`.toLowerCase().includes(q))).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  $('ctxList').innerHTML = list.length ? list.map(c => {
    const used = jobs.filter(j => (j.ctx || []).includes(c.id)).length, inP = projects.filter(p => (p.ctx || []).includes(c.id)).length;
    return `<button class="entry" type="button" data-ctx="${c.id}" aria-current="${c.id === selCtx}"><b>${esc(c.title || 'Untitled')}</b><span class="em"><span>${KINDS[c.kind] || c.kind}</span><span>≈${fmtNum(tok(c.content))} tok</span><span>${inP} project${inP === 1 ? '' : 's'}</span><span>used ${used}×</span></span>${(c.tags || []).length ? `<span class="tags">${c.tags.map(t => `<span class="lbl">${esc(t)}</span>`).join('')}</span>` : ''}</button>`;
  }).join('') : `<div class="empty">${contexts.length ? 'Nothing matches.' : 'No entries yet.'}</div>`;
}
function renderCtxMain(force) {
  const c = ctxById(selCtx), m = $('ctxMain');
  if (!c) {
    ctxFormFor = null;
    const total = contexts.reduce((s, c) => s + tok(c.content), 0), withCtx = jobs.filter(j => (j.ctx || []).length).length;
    const top = [...contexts].map(c => [c, jobs.filter(j => (j.ctx || []).includes(c.id)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    m.innerHTML = `<div class="emptystate"><h3>Context your workers can rely on</h3><p>Keep notes, reference docs, data and style guides here. Attach an entry to a project and it goes out with every task in that project. Attach it to one task for one-off background. Each job shows which context it carried.</p><div class="actions"><button class="btn primary" type="button" data-act="new-ctx">New entry</button><label class="btn" for="ctxFile">Import a text file</label></div></div>
      <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><span class="label">Entries</span><span class="v">${contexts.length}</span></div><div class="kpi"><span class="label">≈ Tokens stored</span><span class="v">${fmtNum(total)}</span></div><div class="kpi"><span class="label">Jobs with context</span><span class="v">${withCtx}</span></div></div>
      ${top.length ? `<div class="section"><div class="section-h"><h3>Most used</h3><span class="sub">jobs that carried it</span></div><div class="util">${top.map(([c, n]) => `<span>${esc(c.title)}</span><div class="track"><span style="width:${n / top[0][1] * 100}%"></span></div><span class="n">${n}</span>`).join('')}</div></div>` : ''}`;
    return;
  }
  if (!force && ctxFormFor === c.id) { paintCtxTok(); return; }
  ctxFormFor = c.id;
  const usedBy = jobs.filter(j => (j.ctx || []).includes(c.id)).slice(-6).reverse();
  m.innerHTML = `<div class="dh"><div style="min-width:0"><span class="label">${KINDS[c.kind] || c.kind}</span><h3>${esc(c.title || 'Untitled')}</h3></div><button class="btn small x" type="button" data-act="close-ctx">Close</button></div>
    <form class="form" id="ctxForm">
      <div class="two"><div><label for="ceTitle">Title</label><input id="ceTitle" maxlength="120" required value="${esc(c.title || '')}"></div><div><label for="ceKind">Type</label><select id="ceKind">${selOpts(Object.entries(KINDS), c.kind)}</select></div></div>
      <label for="ceTags">Tags</label><input id="ceTags" value="${esc((c.tags || []).join(', '))}" placeholder="Comma separated">
      <label for="ceContent">Content</label><textarea id="ceContent" class="big" maxlength="${MAX_CTX}" placeholder="Paste a doc, facts, a schema, a style guide…">${esc(c.content || '')}</textarea>
      <div class="legend"><span id="ceTok"></span></div><div class="budget"><span id="ceBar"></span></div>
      <label>Attach to projects <span class="hint">sent with every task in them</span></label>
      <div class="checks">${projects.length ? projects.map(p => `<label><input type="checkbox" data-p="${p.id}" ${(p.ctx || []).includes(c.id) ? 'checked' : ''}> <span class="dot" style="background:${p.color};margin:0"></span> ${esc(p.name)}</label>`).join('') : '<div class="empty">No projects yet. Make one on the Board.</div>'}</div>
      <div class="actions"><button class="btn primary" type="submit">Save entry</button><button class="btn danger" type="button" data-act="delete-ctx">Delete</button></div>
    </form>
    <div class="section"><span class="label">Recent jobs that carried it</span>${usedBy.length ? `<div class="joblist">${usedBy.map(j => { const [sl, sc] = STATUS[j.status]; return `<div class="job" data-job="${j.id}" role="button" tabindex="0"><img src="${avatar((byWorker(j.workerId || j.pref) || {}).species || 'chick')}" alt=""><span class="txt">#${j.n} ${esc(j.text)}</span><span class="pill" style="--c:${sc}">${sl}</span></div>`; }).join('')}</div>` : '<div class="empty">Not used by any job yet.</div>'}</div>`;
  paintCtxTok();
}
function paintCtxTok() {
  const el = $('ceContent'); if (!el) return;
  const share = Math.min(1, el.value.length / 60000);
  $('ceTok').textContent = `≈ ${fmtNum(tok(el.value))} tokens · ${(share * 100).toFixed(0)}% of the per-job context budget`;
  $('ceBar').style.width = `${share * 100}%`;
}
function newCtx() {
  const c = { id: uid('c_'), title: 'Untitled note', kind: 'note', tags: [], content: '', createdAt: Date.now() };
  contexts.push(c); saveCtx(c); selCtx = c.id; renderContext(true);
  renderCtxMain(true); setTimeout(() => { $('ceTitle').select(); $('ceTitle').focus(); }, 30);
}
$('view-context').addEventListener('click', e => {
  const en = e.target.closest('[data-ctx]');
  if (en) { selCtx = en.dataset.ctx; renderCtxList(); renderCtxMain(true); return; }
  const jb = e.target.closest('[data-job]');
  if (jb) { setView('factory'); openJob(jb.dataset.job); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'new-ctx') newCtx();
  else if (a.dataset.act === 'close-ctx') { selCtx = null; renderContext(); }
  else if (a.dataset.act === 'delete-ctx') confirmClick(a, 'Confirm delete', () => {
    const c = ctxById(selCtx); if (!c) return;
    contexts = contexts.filter(x => x !== c); store.delDoc('context', c.id);
    for (const p of projects) if ((p.ctx || []).includes(c.id)) { p.ctx = p.ctx.filter(x => x !== c.id); saveProject(p); }
    for (const t of tasks) if ((t.ctx || []).includes(c.id)) { t.ctx = t.ctx.filter(x => x !== c.id); saveTask(t); }
    selCtx = null; renderContext(); toast(`Deleted ${c.title}.`);
  });
});
$('ctxMain').addEventListener('input', e => { if (e.target.id === 'ceContent') paintCtxTok(); });
$('ctxMain').addEventListener('submit', e => {
  e.preventDefault();
  const c = ctxById(selCtx); if (!c) return;
  c.title = ($('ceTitle').value.trim() || 'Untitled').slice(0, 120); c.kind = $('ceKind').value;
  c.tags = $('ceTags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  c.content = $('ceContent').value.slice(0, MAX_CTX); saveCtx(c);
  const want = new Set([...$('ctxMain').querySelectorAll('input[data-p]:checked')].map(i => i.dataset.p));
  for (const p of projects) {
    const has = (p.ctx || []).includes(c.id);
    if (want.has(p.id) && !has) { p.ctx = [...(p.ctx || []), c.id]; saveProject(p); }
    else if (!want.has(p.id) && has) { p.ctx = p.ctx.filter(x => x !== c.id); saveProject(p); }
  }
  toast(`Saved ${c.title}.`); renderCtxList(); renderCtxMain(true);
});
$('ctxSearch').addEventListener('input', renderCtxList);
$('ctxKind').addEventListener('change', renderCtxList);
$('ctxFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = ''; let last = null;
  for (const f of files) {
    if (f.size > 2e6) { toast(`${f.name} is over 2 MB. Split it into smaller files.`); continue; }
    let text = ''; try { text = await f.text(); } catch { toast(`Could not read ${f.name}.`); continue; }
    const c = { id: uid('c_'), title: f.name.replace(/\.[^.]+$/, '').slice(0, 120), kind: /\.(csv|json|ya?ml|xml)$/i.test(f.name) ? 'data' : 'doc', tags: ['imported'], content: text.slice(0, MAX_CTX), createdAt: Date.now() };
    contexts.push(c); saveCtx(c); last = c;
    if (text.length > MAX_CTX) toast(`${f.name} was trimmed to ${fmtNum(MAX_CTX)} characters.`);
  }
  if (last) { selCtx = last.id; if (view !== 'context') setView('context'); else { renderCtxList(); renderCtxMain(true); } }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('taskDrawer').hidden) { $('taskDrawer').hidden = true; editingTask = null; } else if (!$('projDrawer').hidden) $('projDrawer').hidden = true; } });
let boardHold = false;
$('view-board').addEventListener('pointerdown', () => { boardHold = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { boardHold = false; }, 80); });
setInterval(() => {
  if (view !== 'board' || dragging || !ready) return;
  if (!boardHold && tasks.some(t => t.projectId === curProject && (() => { const j = lastJob(t); return j && isActive(j); })())) renderCols();
  if (editingTask && !$('taskDrawer').hidden) paintTaskRuns(false);
}, 1500);

// ---------- foreman assistant ----------
const findWorker = name => { if (!name) return null; const n = String(name).trim().toLowerCase(); return workers.find(w => w.id === name || w.name.toLowerCase() === n) || null; };
const findProject = k => { const s = String(k || '').trim().toLowerCase(); return projects.find(p => p.key.toLowerCase() === s || p.name.toLowerCase() === s || p.id === k) || null; };
const findTask = key => { const m = String(key || '').trim().toUpperCase().match(/^([A-Z0-9]+)-(\d+)$/); if (!m) return null; const p = projects.find(p => p.key.toUpperCase() === m[1]); return (p && tasks.find(t => t.projectId === p.id && t.n === +m[2])) || null; };
const jobByN = n => jobs.find(j => j.n === Number(String(n).replace('#', '')));
// The foreman's tools live in the engine (src/engine.js), which runs them for
// both this window and the desktop pet.
const chatDocMessages = () => chat.filter(m => !m.pending).slice(-40).map(m => ({ role: m.role, text: String(m.text || '').slice(0, 8000), actions: (m.actions || []).slice(0, 20), t: m.t || 0, error: !!m.error }));
function saveChat() { if (store.mode === 'db') store.saveDoc('assistant', { id: 'chat', messages: chatDocMessages() }); else store.saveLocal(); }
let asBusy = false, asCtl = null;
function afterToolChange() { renderDash(); if (view === 'board') renderBoard(); }
async function askForeman(text) {
  text = String(text || '').trim();
  if (!text || asBusy) return;
  asBusy = true; paintChat();
  await api.askForeman(text);
}

function foremanNotice() {}

// --- chat rendering
let fAv = null, fAvKey = '';
function foremanAvatar() {
  if (fAvKey !== foreman.species) {
    fAvKey = foreman.species;
    const cv = document.createElement('canvas'); cv.width = cv.height = 96;
    drawPet(cv.getContext('2d'), foreman.species, 48, 86, { scale: 2.45, hat: '#FF8A3D', hatLine: '#D9652A', boss: true });
    fAv = cv.toDataURL();
  }
  return fAv;
}
function msgHTML(m, mini) {
  if (m.role === 'user') return `<div class="msg me"><div class="b">${esc(m.text)}</div></div>`;
  const t = m.text || '';
  const body = t ? (mini ? esc(t.length > 420 ? t.slice(0, 420) + '…' : t).replace(/\n/g, '<br>') : md(t)) : '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
  return `<div class="msg ${m.error ? 'err' : ''}">${mini ? '' : `<img src="${foremanAvatar()}" alt="">`}<div class="b">${body}${(m.actions || []).length ? `<div class="acts">${m.actions.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}</div></div>`;
}
let chatQueued = false;
function paintChat() { if (chatQueued) return; chatQueued = true; requestAnimationFrame(() => { chatQueued = false; paintChatNow(); }); }
function paintChatNow() {
  const log = $('chatLog'), stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  log.innerHTML = chat.length ? chat.map(m => msgHTML(m, false)).join('') : `<div class="emptystate" style="margin:auto;align-items:center;text-align:center"><img src="${foremanAvatar()}" alt="" style="width:76px;height:76px;border-radius:22px;background:var(--panel-2)"><h3>Hi, I'm ${esc(foreman.name)}</h3><p>Tell me what you need. I'll hand it to the right worker, plan it on the board, or check on what's running.</p></div>`;
  if (stick || asBusy) log.scrollTop = log.scrollHeight;
  const mini = $('miniLog');
  mini.innerHTML = chat.slice(-4).map(m => msgHTML(m, true)).join('') || '<div class="empty">Ask me to get something done.</div>';
  mini.scrollTop = mini.scrollHeight;
  $('chatStop').hidden = !asBusy; $('chatSend').disabled = asBusy; $('miniSend').disabled = asBusy;
  $('asMode').textContent = sampleFn ? (asBusy ? 'working…' : 'ready') : 'Claude Code not ready';
  $('asMode').className = 'mode' + (sampleFn ? ' live' : ' sim');
}
function syncForemanUI() {
  $('asName').textContent = `${foreman.name}, your foreman`;
  $('asNameIn').value = foreman.name; $('asSpecies').value = foreman.species; $('asTier').value = foreman.tier;
  $('miniName').textContent = foreman.name; $('miniAv').src = foremanAvatar();
}
$('asSpecies').innerHTML = Object.keys(SPECIES).map(s => `<option value="${s}">${s}</option>`).join('');
const AS_EXAMPLES = ['What is everyone working on?', 'Have the coder write a function that validates email addresses', 'Plan a project to launch a newsletter and add four tasks', 'Summarize the output of the last finished job'];
$('asExamples').innerHTML = AS_EXAMPLES.map((x, i) => `<button class="chip" type="button" data-ex="${i}">${esc(x)}</button>`).join('');
$('asExamples').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { $('chatInput').value = AS_EXAMPLES[+b.dataset.ex]; $('chatInput').focus(); } });
$('chatForm').addEventListener('submit', e => { e.preventDefault(); const v = $('chatInput').value; if (!v.trim() || asBusy) return; $('chatInput').value = ''; askForeman(v); });
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } });
$('chatStop').addEventListener('click', () => api.stopForeman());
$('chatClear').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm clear', () => { if (asBusy) return; chat = []; api.clearChat(); paintChatNow(); }));
$('asSettings').addEventListener('submit', e => {
  e.preventDefault();
  foreman = { name: ($('asNameIn').value.trim() || 'Marmalade').slice(0, 20), species: $('asSpecies').value, tier: $('asTier').value === 'default' ? 'default' : 'quick' };
  store.saveFactory(); syncForemanUI(); paintChatNow(); toast(`Saved ${foreman.name}.`);
});
$('miniForm').addEventListener('submit', e => { e.preventDefault(); const v = $('miniInput').value; if (!v.trim() || asBusy) return; $('miniInput').value = ''; askForeman(v); });
$('miniOpen').addEventListener('click', () => { closeMini(); setView('assistant'); setTimeout(() => $('chatInput').focus(), 30); });
$('miniClose').addEventListener('click', () => closeMini());

// --- roaming pet
const RS = 76;
const roam = { on: false, x: 200, y: 0, vy: 0, face: 1, state: 'fall', t: 0, phase: 0, drag: null, blinkAt: 2, blinkT: 0, sayT: 0 };
let miniOpen = false;
const roamCv = $('roamCv'), roamCtx = roamCv.getContext('2d'), dockCv = $('asPet'), dockCtx = dockCv.getContext('2d');
const floorY = () => window.innerHeight - RS - 4;
function persistRoam() { lsSet('burrowby.roam', JSON.stringify({ on: roam.on, x: Math.round(roam.x) })); }
function syncRoamBtn() {}
function release(x, y) { roam.on = true; roam.x = clamp(x, 0, window.innerWidth - RS); roam.y = clamp(y, 0, floorY()); roam.vy = 0; roam.state = 'fall'; $('roamer').hidden = false; syncRoamBtn(); }
function dock() { roam.on = false; roam.drag = null; $('roamer').hidden = true; $('roamSay').hidden = true; closeMini(); persistRoam(); syncRoamBtn(); }
function openMini() { miniOpen = true; $('roamChat').hidden = false; $('roamSay').hidden = true; paintChatNow(); setTimeout(() => $('miniInput').focus(), 30); }
function closeMini() { miniOpen = false; $('roamChat').hidden = true; }
function roamSay(text, thinking) {
  if (!roam.on || miniOpen) return;
  const el = $('roamSay');
  if (thinking) { el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; roam.sayT = 9999; }
  else { const t = String(text || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim(); el.textContent = t.length > 140 ? t.slice(0, 140) + '…' : t; roam.sayT = 8; }
  el.hidden = false;
}
function overDock(e) { if (view !== 'assistant') return false; const r = $('asDock').getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }
function startDrag(e, fromDock) {
  if (e.button > 0) return;
  e.preventDefault();
  if (fromDock) { if (roam.on) return; release(e.clientX - RS / 2, e.clientY - RS / 2); $('roamSay').hidden = true; }
  roam.drag = { dx: e.clientX - roam.x, dy: e.clientY - roam.y, sx: e.clientX, sy: e.clientY, moved: false, fromDock };
}
roamCv.addEventListener('pointerdown', e => startDrag(e, false));
dockCv.addEventListener('click', () => api.petCommand('reset'));
roamCv.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); miniOpen ? closeMini() : openMini(); } });
window.addEventListener('pointermove', e => {
  const d = roam.drag; if (!d) return;
  if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
  roam.x = clamp(e.clientX - d.dx, 0, window.innerWidth - RS); roam.y = clamp(e.clientY - d.dy, 0, floorY());
  $('asDock').classList.toggle('target', d.moved && overDock(e));
});
window.addEventListener('pointerup', e => {
  const d = roam.drag; if (!d) return;
  roam.drag = null; $('asDock').classList.remove('target');
  if (!d.moved) { if (d.fromDock) { dock(); $('chatInput').focus(); } else (miniOpen ? closeMini() : openMini()); return; }
  if (overDock(e)) { dock(); toast(`${foreman.name} is back in the dock.`); return; }
  roam.state = 'fall'; roam.vy = 0; persistRoam();
});
$('roamBtn').addEventListener('click', () => { api.petCommand('reset'); toast(`${foreman.name} is dropping onto your taskbar.`); });
window.addEventListener('resize', () => { if (roam.on) { roam.x = clamp(roam.x, 0, window.innerWidth - RS); if (roam.y > floorY()) roam.y = floorY(); } });

function drawForeman(c, x, y, sc, mood) {
  let bob = 0, sx = 1, sy = 1;
  if (mood === 'walk') { const s = Math.abs(Math.sin(roam.phase)); bob = -s * 3; sx = 1 + (1 - s) * 0.05; sy = 1 - (1 - s) * 0.05; }
  else if (mood === 'fall') { sx = 0.94; sy = 1.08; }
  else if (mood === 'land') { sx = 1.12; sy = 0.86; }
  else if (mood === 'held') { bob = Math.sin(rt * 12) * 1.2; }
  else { const br = Math.sin(rt * 2.4) * 0.035; sy = 1 + br; sx = 1 - br; }
  c.fillStyle = 'rgba(40,30,20,.18)'; ell(c, x, y + 1, 13 * sc * (mood === 'fall' || mood === 'held' ? 0.6 : 1), 3.6 * sc); c.fill();
  drawPet(c, foreman.species, x, y, { scale: sc, bob, sx, sy, face: roam.face, blink: roam.blinkT > 0, sleep: mood === 'sit' && Math.sin(rt * 0.5) > 0.6, focus: asBusy, hat: '#FF8A3D', hatLine: '#D9652A', boss: true });
  if (asBusy) for (let i = 0; i < 3; i++) { const o = Math.sin(rt * 6 - i * 0.8) * 1.5; c.fillStyle = '#FF8A3D'; ell(c, x - 6 * sc / 2 + i * 3 * sc, y - 40 * sc + o, 1.3 * sc, 1.3 * sc); c.fill(); }
}
function stepForeman(dt) {
  roam.blinkAt -= dt; if (roam.blinkAt <= 0) { roam.blinkT = 0.14; roam.blinkAt = rand(2, 5); } if (roam.blinkT > 0) roam.blinkT -= dt;
  const dprR = Math.min(window.devicePixelRatio || 1, 2);
  if (view === 'assistant') {
    dockCtx.setTransform(1, 0, 0, 1, 0, 0); dockCtx.clearRect(0, 0, 320, 240);
    if (!roam.on) { drawForeman(dockCtx, 160, 205, 4.2, asBusy ? 'idle' : 'idle'); }
    else { dockCtx.globalAlpha = 0.18; drawPet(dockCtx, foreman.species, 160, 205, { scale: 4.2, hat: '#FF8A3D', hatLine: '#D9652A', boss: true }); dockCtx.globalAlpha = 1; }
  }
  if (!roam.on) return;
  if (!roam.drag) {
    const fy = floorY();
    if (roam.y < fy - 0.5) { roam.state = 'fall'; roam.vy += 2200 * dt; roam.y = Math.min(fy, roam.y + roam.vy * dt); if (roam.y >= fy) { roam.vy = 0; roam.state = 'land'; roam.t = 0.22; } }
    else {
      roam.y = fy; roam.t -= dt;
      if (roam.t <= 0) {
        const r = Math.random();
        if (asBusy || miniOpen) { roam.state = 'idle'; roam.t = 0.8; }
        else if (r < 0.55) { roam.state = 'walk'; roam.face = Math.random() < 0.5 ? -1 : 1; roam.t = rand(2, 6); }
        else if (r < 0.85) { roam.state = 'sit'; roam.t = rand(2, 5); }
        else { roam.state = 'idle'; roam.t = rand(1, 2); roam.face *= -1; }
      }
      if (roam.state === 'walk') {
        roam.phase += dt * 10; roam.x += roam.face * 55 * dt;
        if (roam.x < 4) { roam.x = 4; roam.face = 1; } if (roam.x > window.innerWidth - RS - 4) { roam.x = window.innerWidth - RS - 4; roam.face = -1; }
      }
    }
  }
  const el = $('roamer'); el.style.transform = `translate(${roam.x}px, ${roam.y}px)`;
  if (roamCv.width !== RS * dprR) { roamCv.width = RS * dprR; roamCv.height = RS * dprR; }
  roamCtx.setTransform(dprR, 0, 0, dprR, 0, 0); roamCtx.clearRect(0, 0, RS, RS);
  drawForeman(roamCtx, RS / 2, RS - 6, 1.9, roam.drag ? 'held' : roam.state);
  if (roam.sayT > 0 && roam.sayT < 9999) { roam.sayT -= dt; if (roam.sayT <= 0) $('roamSay').hidden = true; }
  if (roam.sayT >= 9999 && !asBusy) { roam.sayT = 0; }
  const say = $('roamSay');
  if (!say.hidden) { const w = say.offsetWidth, h = say.offsetHeight; say.style.transform = `translate(${clamp(roam.x + RS / 2 - w / 2, 8, window.innerWidth - w - 8)}px, ${Math.max(8, roam.y - h - 2)}px)`; }
  const box = $('roamChat');
  if (!box.hidden) { const w = box.offsetWidth, h = box.offsetHeight; const top = roam.y - h - 8 > 8 ? roam.y - h - 8 : Math.min(window.innerHeight - h - 8, roam.y + RS + 8); box.style.transform = `translate(${clamp(roam.x + RS / 2 - w / 2, 8, window.innerWidth - w - 8)}px, ${Math.max(8, top)}px)`; }
}
syncRoamBtn();

// ---------- export ----------
$('exportBtn').addEventListener('click', async () => {
  const r = await api.exportData();
  if (r && r.ok) toast(`Export saved to ${r.path}.`);
  else if (r && r.error) toast(r.error);
});
$('settingsBtn').addEventListener('click', () => api.openSettings());
$('mode').addEventListener('click', () => { if (!sampleFn) api.openSettings(); });

// ---------- boot ----------
layout(); drawBackground(); fit(); syncWorkerSelect(); syncConc();
setTab(['overview', 'jobs', 'workers'].includes(tab) ? tab : 'overview');
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBackground);
setInterval(renderDash, 700);
requestAnimationFrame(frame);
// ---------- engine sync ----------
let cliInfo = { message: 'Checking Claude Code…' };
// Merge by id into the existing objects so references held by open drawers stay valid.
function mergeList(cur, incoming) {
  const old = new Map(cur.map(x => [x.id, x]));
  return incoming.map(o => { const x = old.get(o.id); if (!x) return o; for (const k of Object.keys(x)) if (!(k in o)) delete x[k]; return Object.assign(x, o); });
}
function mergeJob(o) {
  if (!o) return o;
  const x = jobById(o.id);
  if (!x) { jobs.push(o); jobs.sort((a, b) => a.createdAt - b.createdAt); return o; }
  const was = x.status;
  for (const k of Object.keys(x)) if (!(k in o)) delete x[k];
  Object.assign(x, o);
  if (was !== x.status && (x.status === 'done' || x.status === 'failed' || x.status === 'cancelled')) onJobFinished(x);
  if (selJob === x.id) { paintOutput(); paintJobActions(); }
  return x;
}
function applyFactory(f) {
  const before = workers.map(w => w.id).join();
  workers = mergeList(workers, f.workers);
  for (const id of [...vis.keys()]) if (!byWorker(id)) vis.delete(id);
  concurrency = f.concurrency; foreman = f.foreman; autoPull = f.autoPull === true;
  paintAutoPull();
  if (before !== workers.map(w => w.id).join()) layout();
  syncWorkerSelect(); syncConc(); syncForemanUI();
}
function applyPatch(p) {
  if (p.factory) applyFactory(p.factory);
  if (p.jobs) for (const j of p.jobs) mergeJob(j);
  if (p.removedJobs) { const gone = new Set(p.removedJobs); jobs = jobs.filter(j => !gone.has(j.id)); if (gone.has(selJob)) selJob = null; }
  if (p.lastRateLimit) lastRateLimit = p.lastRateLimit;
  if (p.projects) { projects = mergeList(projects, p.projects); syncProjectSelect(); }
  if (p.tasks) tasks = mergeList(tasks, p.tasks);
  if (p.contexts) contexts = mergeList(contexts, p.contexts);
  if (p.chat) { chat = p.chat; asBusy = !!p.chatBusy; paintChat(); }
  if ((p.projects || p.tasks) && view === 'board' && !dragging) renderBoard();
  if ((p.contexts || p.projects) && view === 'context') { renderCtxList(); renderCtxMain(false); }
}
function loadSnapshot(s) {
  applyFactory(s.factory);
  jobs = s.jobs; projects = s.projects; tasks = s.tasks; contexts = s.contexts;
  chat = s.chat; asBusy = !!s.chatBusy; lastRateLimit = s.lastRateLimit || 0;
  vis.clear(); layout(); syncProjectSelect();
}
function applyCli(st) {
  cliInfo = st;
  sampleFn = st.ready ? true : null;
  syncMode(); paintChat();
}
api.onPatch(applyPatch);
api.onReset(s => { selJob = null; selWorker = null; editingTask = null; $('taskDrawer').hidden = true; $('projDrawer').hidden = true; loadSnapshot(s); renderDash(); setView(view); paintChatNow(); });
api.onNotice(n => { if (['task-review', 'task-testing', 'task-qa-fail'].includes(n.kind)) toast(n.text); });
api.onCliStatus(applyCli);
api.onShowView(v => setView(v));
(async () => {
  try {
    loadSnapshot(await api.getState());
  } catch (e) { console.warn('load failed', e); toast('Could not load saved work.'); }
  applyCli(await api.cliStatus());
  ready = true; $('assignBtn').disabled = false; syncMode(); renderDash(); setView(view);
  syncForemanUI(); paintChatNow();
})();
})();
