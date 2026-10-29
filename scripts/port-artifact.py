# Ports the Burrowby Works artifact (burrowby.html) into the desktop app's
# main window: python scripts/port-artifact.py <burrowby.html> src/renderer
# Writes app.html, app.css and app.js. Each replacement asserts it matched, so
# a changed artifact fails loudly instead of producing a half-ported page.
import re, sys, os
src, outdir = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf8').read()

css = html[html.index('<style>') + 7: html.index('</style>')]
markup = html[html.index('</style>') + 8: html.index('<script>')]
js = html[html.index('<script>') + 8: html.rindex('</script>')]

def rep(s, a, b, count=1):
    n = s.count(a)
    if n != count:
        raise SystemExit(f'expected {count} match(es), found {n}: {a[:90]!r}')
    return s.replace(a, b)

def rep_between(s, start, end, new, include_end=True):
    i = s.index(start)
    j = s.index(end, i) + (len(end) if include_end else 0)
    return s[:i] + new + s[j:]

# ---------------- CSS ----------------
css += """
/* desktop app additions: the claude.ai host used to reset the body margin */
body{margin:0}
[hidden]{display:none!important}
@media (min-width: 981px){ body{overflow:hidden} }
#roamer,.roam-say,.roam-chat{display:none!important}
.mode.sim{cursor:pointer}
"""

# ---------------- markup ----------------
markup = rep(markup, '<button class="btn small" type="button" id="exportBtn" title="Save all workers, jobs, projects, tasks, context and chat as a JSON file">Export data</button>',
             '<button class="btn small" type="button" id="exportBtn" title="Save all workers, jobs, projects, tasks, context and chat as a JSON file">Export data</button><button class="btn small" type="button" id="settingsBtn" title="Claude Code, models, import">Settings</button>')
markup = rep(markup, '<canvas id="asPet" width="320" height="240" aria-label="Your foreman. Drag out to let it roam the screen."></canvas>',
             '<canvas id="asPet" width="320" height="240" aria-label="Your foreman."></canvas>')
markup = rep(markup, "<p class=\"hint\" id=\"dockHint\">Drag me out of this box and I'll walk around the screen. Click me anytime to talk.</p>",
             '<p class="hint" id="dockHint">I also live on your desktop, walking along the taskbar. Click me there to chat.</p>')
markup = rep(markup, '<button class="btn primary small" type="button" id="roamBtn">Let it roam</button>',
             '<button class="btn primary small" type="button" id="roamBtn">Drop me on the taskbar</button>')

# ---------------- script ----------------
# 1. storage -> engine IPC
js = rep_between(js, 'const store = {', '\n};\n', """const api = window.works;
const COLL = { context: 'contexts', projects: 'projects', tasks: 'tasks' };
// Writes go to the engine in the main process; it saves to disk and echoes
// the change back to every window.
const store = {
  mode: 'app',
  saveFactory() { api.setFactory({ workers: workers.map(w => ({ id: w.id, name: w.name, species: w.species, specialty: w.specialty })), concurrency, foreman }); },
  saveJob() {},
  deleteJob(j) { api.deleteJobs([j.id]); },
  saveDoc(coll, o) { if (COLL[coll]) api.upsert(COLL[coll], JSON.parse(JSON.stringify(o))); },
  delDoc(coll, id) { if (COLL[coll]) api.remove(COLL[coll], id); },
  saveLocal() {},
};
""")

# 2. jobs: creation via engine, runner/scheduler removed
js = rep_between(js, 'function createJob(text, pref, tier, extra = {}) {', '\n}\n', """async function createJob(text, pref, tier, extra = {}) {
  return mergeJob(await api.createJob({ text, pref, tier, extra }));
}
""")
js = rep(js, "  upstream_error: 'A connection problem interrupted the job.',\n};",
         "  upstream_error: 'A connection problem interrupted the job.',\n  timeout: 'The job ran longer than 15 minutes and was stopped.',\n};")
js = rep_between(js, 'async function runJob(j, w) {', 'function schedule() {', '', include_end=False)
js = rep_between(js, 'function schedule() {', '\n}\n', """// Jobs run in the main process; the floor only animates them. When a job
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
""")
js = rep(js, "  schedule();\n  const now = performance.now();", "  syncVisuals();\n  const now = performance.now();")

# 3. Claude availability: Claude Code CLI status instead of window.claude
js = rep(js, "  if (Date.now() - lastRateLimit < 10 * 60e3) out.push(['warn', 'Claude rate-limited this page in the last 10 minutes.']);\n  if (sampleBlocked) out.push(['info', `${ERROR_COPY[sampleBlocked] || 'Claude is unavailable.'} New jobs run as simulations.`]);\n  else if (ready && !sampleFn) out.push(['info', 'Claude isn’t connected in this view, so new jobs run as simulations.']);",
         "  if (Date.now() - lastRateLimit < 10 * 60e3) out.push(['warn', 'Your Claude plan hit a usage limit in the last 10 minutes.']);\n  if (ready && !sampleFn) out.push(['info', `${cliInfo.message} New jobs wait in the queue until it's ready.`]);")
js = rep(js, "  if (sampleFn && !sampleBlocked) { m.textContent = 'Working with Claude'; m.className = 'mode live'; }\n  else { m.textContent = 'Simulation mode'; m.className = 'mode sim'; }\n  m.title = store.mode === 'db' ? 'Jobs are saved to your account' : store.mode === 'local' ? 'Jobs are saved in this browser' : 'Jobs are not saved';",
         "  if (sampleFn) { m.textContent = 'Working with Claude'; m.className = 'mode live'; m.title = cliInfo.message + ' Jobs are saved on this PC.'; }\n  else { m.textContent = 'Claude Code not ready'; m.className = 'mode sim'; m.title = cliInfo.message + ' Click to open Settings.'; }")

# 4. Factory interactions
js = rep(js, """$('assign').addEventListener('submit', e => {
  e.preventDefault();""", """$('assign').addEventListener('submit', async e => {
  e.preventDefault();""")
js = rep(js, "  const j = createJob(text.slice(0, 8000), $('jobWorker').value, $('jobTier').value, p ? { projectId: p.id, ctx: (p.ctx || []).filter(ctxById) } : {});\n  $('jobText').value = '';",
         "  $('jobText').value = '';\n  const j = await createJob(text.slice(0, 8000), $('jobWorker').value, $('jobTier').value, p ? { projectId: p.id, ctx: (p.ctx || []).filter(ctxById) } : {});")
js = rep(js, """    if (j.status === 'queued') { j.status = 'cancelled'; j.finishedAt = Date.now(); store.saveJob(j); }
    else controllers.get(j.id)?.abort();
  } else if (a.dataset.act === 'retry') {
    const n = createJob(j.text, j.workerId && byWorker(j.workerId) ? j.workerId : 'any', j.tier); openJob(n.id); return;""",
         """    mergeJob(await api.stopJob(j.id));
  } else if (a.dataset.act === 'retry') {
    const n = mergeJob(await api.retryJob(j.id)); openJob(n.id); return;""")
js = rep(js, """  jobs = jobs.filter(isActive); for (const j of gone) store.deleteJob(j);""",
         """  jobs = jobs.filter(isActive); api.clearFinished();""")
js = rep(js, """  if (!workerFree(w)) { toast(`${w.name} is mid-job. Wait until they're back at their bench.`); return; }
  if (workers.length <= 1) { toast('The factory needs at least one worker.'); return; }""",
         """  if (!workerFree(w) || jobs.some(j => j.status === 'running' && j.workerId === w.id)) { toast(`${w.name} is mid-job. Wait until they're back at their bench.`); return; }
  if (workers.length <= 1) { toast('The factory needs at least one worker.'); return; }""")
js = rep(js, """  for (const j of jobs) if (j.status === 'queued' && j.pref === w.id) { j.pref = 'any'; store.saveJob(j); }
  workers = workers.filter(x => x !== w); vis.delete(w.id); selWorker = null;
  layout(); store.saveFactory(); syncWorkerSelect();""",
         """  api.retireWorker(w.id).then(r => { if (!r.ok) toast(r.error); });
  workers = workers.filter(x => x !== w); vis.delete(w.id); selWorker = null;
  layout(); syncWorkerSelect();""")

# 5. Board
js = rep_between(js, 'function sendTask(t) {', '\n}\n', """async function sendTask(t) {
  const j = mergeJob(await api.sendTask(t.id));
  toast(`${taskKey(t)} is on the intake belt as job #${j.n}.`);
  return j;
}
""")
js = rep_between(js, 'function onJobFinished(j) {', '\n}\n', """function onJobFinished(j) {
  const t = j.taskId && taskById(j.taskId); if (!t) return;
  if (view === 'board' && !dragging) renderCols();
  if (editingTask === t) paintTaskRuns(true);
}
""")
js = rep_between(js, 'function sampleProject() {', '\n}\n', """async function sampleProject() {
  const p = await api.sampleProject();
  curProject = p.id; lsSet('burrowby.project', p.id); syncProjectSelect(); renderBoard();
  toast('Added a sample project. Open a task and send it to the factory.');
}
""")
js = rep(js, "  if (!sampleFn || sampleBlocked || !sampleFn.json) { toast('Suggesting tasks needs Claude, which isn’t available in this view.'); return; }",
         "  if (!sampleFn) { toast('Suggesting tasks needs Claude Code. Open Settings to set it up.'); return; }")
js = rep_between(js, "  const existing = tasks.filter(t => t.projectId === p.id)", "  } finally {", """  try {
    const items = await api.suggestTasks(p.id);
    if (!items.length) toast('No suggestions came back. Add a project description and try again.');
    else { suggestions = { pid: p.id, items }; renderSuggest(); }
  } catch (e) {
    toast(String(e && e.message || 'Could not get suggestions. Try again.').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
""", include_end=False)
js = rep(js, "  if (a.dataset.act === 'send') { const t = saveTaskForm(); if (t) { sendTask(t); openTask(t, false); renderCols(); } return; }",
         "  if (a.dataset.act === 'send') { const t = saveTaskForm(); if (t) sendTask(t).then(() => { openTask(t, false); renderCols(); }); return; }")

# 6. Foreman: one conversation, held by the engine
js = rep_between(js, 'async function askForeman(text) {', '\nfunction foremanNotice(j) {', """async function askForeman(text) {
  text = String(text || '').trim();
  if (!text || asBusy) return;
  asBusy = true; paintChat();
  await api.askForeman(text);
}
""", include_end=False)
js = rep_between(js, 'function foremanNotice(j) {', '\n}\n', 'function foremanNotice() {}\n')
js = rep(js, "  $('asMode').textContent = sampleFn && !sampleBlocked ? (asBusy ? 'working…' : 'ready') : 'Claude unavailable here';\n  $('asMode').className = 'mode' + (sampleFn && !sampleBlocked ? ' live' : ' sim');",
         "  $('asMode').textContent = sampleFn ? (asBusy ? 'working…' : 'ready') : 'Claude Code not ready';\n  $('asMode').className = 'mode' + (sampleFn ? ' live' : ' sim');")
js = rep(js, "$('chatStop').addEventListener('click', () => { if (asCtl) asCtl.abort(); });", "$('chatStop').addEventListener('click', () => api.stopForeman());")
js = rep(js, "$('chatClear').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm clear', () => { if (asBusy) return; chat = []; saveChat(); paintChatNow(); }));",
         "$('chatClear').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm clear', () => { if (asBusy) return; chat = []; api.clearChat(); paintChatNow(); }));")

# 7. In-page roaming pet: the desktop pet replaces it
js = rep(js, "dockCv.addEventListener('pointerdown', e => startDrag(e, true));", "dockCv.addEventListener('click', () => api.petCommand('reset'));")
js = rep(js, """$('roamBtn').addEventListener('click', () => { if (roam.on) dock(); else { release(window.innerWidth / 2 - RS / 2, 80); persistRoam(); roamSay(`Hi! I'm ${foreman.name}. Click me to give orders.`); } });""",
         """$('roamBtn').addEventListener('click', () => { api.petCommand('reset'); toast(`${foreman.name} is dropping onto your taskbar.`); });""")
js = rep_between(js, 'function syncRoamBtn() {', '\n}\n', 'function syncRoamBtn() {}\n')
js = rep(js, "try { const r = JSON.parse(lsGet('burrowby.roam') || 'null'); if (r && r.on) { release(Number(r.x) || 120, floorY()); } } catch {}\n", '')
js = rep(js, "roam.x += roam.face * (reduceMotion ? 25 : 55) * dt;", "roam.x += roam.face * 55 * dt;")

# 8. Export through a save dialog in the main process
js = rep_between(js, "$('exportBtn').addEventListener('click', async () => {", '\n});\n', """$('exportBtn').addEventListener('click', async () => {
  const r = await api.exportData();
  if (r && r.ok) toast(`Export saved to ${r.path}.`);
  else if (r && r.error) toast(r.error);
});
$('settingsBtn').addEventListener('click', () => api.openSettings());
$('mode').addEventListener('click', () => { if (!sampleFn) api.openSettings(); });
""")

# 9. Boot from the engine's snapshot and follow its patches
js = rep_between(js, "(async () => {\n  const cl = window.claude;", '\n})();\n', """// ---------- engine sync ----------
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
  concurrency = f.concurrency; foreman = f.foreman;
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
api.onNotice(n => { if (n.kind === 'task-review') toast(n.text); });
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
""")

# 10. The page's copy of the foreman tools is dead: the engine runs them
i = js.index('const foremanJobs = new Set();'); j = js.index('const chatDocMessages')
js = js[:i] + "// The foreman's tools live in the engine (src/engine.js), which runs them for\n// both this window and the desktop pet.\n" + js[j:]

# 11. Coding workers, repositories, PM tickets, Stop all (desktop app only)
markup = rep(markup, '<div><label for="wdSpecies">Species</label><select id="wdSpecies"></select></div>\n            </div>',
             '<div><label for="wdSpecies">Species</label><select id="wdSpecies"></select></div>\n            </div>\n            <label for="wdCap">Capability</label>\n            <select id="wdCap"><option value="text">Text only: writes answers</option><option value="code">Code: edits project repos in a worktree and opens PRs</option><option value="pm">Project manager: proposes tickets</option></select>')
markup = rep(markup, '<button class="btn small" type="button" id="settingsBtn"',
             '<button class="btn small danger" type="button" id="stopAllBtn" title="Stop every queued and running job">Stop all jobs</button><button class="btn small" type="button" id="settingsBtn"')
markup = rep(markup, '<div class="section"><span class="label">Output</span><div class="output" id="jdOutput"></div></div>',
             '<div class="section code-info" id="jdCode" hidden></div>\n          <div class="section"><span class="label">Output</span><div class="output" id="jdOutput"></div></div>')
markup = rep(markup, '<button class="btn small" type="button" data-act="edit-project">Edit project</button>',
             '<button class="btn small" type="button" id="releaseBtn" hidden title="Fast-forward prod to dev. Only you can do this.">Release to prod</button>\n          <button class="btn small" type="button" data-act="edit-project">Edit project</button>')
markup = rep(markup, '<p class="desc"><span id="bhDesc"></span> <span class="key" id="bhCtx"></span></p>',
             '<p class="desc"><span id="bhDesc"></span> <span class="key" id="bhCtx"></span></p>\n          <p class="desc repo-note" id="bhRepo" hidden></p>')
markup = rep(markup, '<label>Project context <span class="hint">sent with every task in this project</span></label><div class="checks" id="pdCtx"></div>',
             '<label>Project context <span class="hint">sent with every task in this project</span></label><div class="checks" id="pdCtx"></div>\n    <label for="pdRepo">Repository <span class="hint">GitHub URL or local folder; the app keeps its own clone</span></label>\n    <div class="assign-row"><input id="pdRepo" class="grow" placeholder="https://github.com/you/repo or C:\\path\\to\\repo" spellcheck="false"><button class="btn small" type="button" data-act="set-repo" id="pdRepoBtn">Connect</button></div>\n    <p class="hint repo-note" id="pdRepoNote"></p>')
css += """
.code-info .files{font:12px/1.5 var(--f-mono);margin:4px 0 0;padding:0;list-style:none;max-height:140px;overflow:auto}
.code-info .files b{color:var(--ok);font-weight:500}.code-info .files i{color:var(--crit);font-style:normal}
.code-info .steps{font:12px/1.5 var(--f-mono);margin:4px 0 0;padding:0 0 0 2px;list-style:none;max-height:180px;overflow:auto;color:var(--muted)}
.code-info .steps li::before{content:'› ';color:var(--accent)}
.code-info .pr{font-weight:700}
.code-info a,.joblist a{color:var(--accent)}
.repo-note{font-size:12px;color:var(--muted)}
.proposals label{display:flex;gap:8px;align-items:flex-start;padding:4px 0}
.proposals small{display:block;color:var(--muted)}
"""
js = rep(js, "api.setFactory({ workers: workers.map(w => ({ id: w.id, name: w.name, species: w.species, specialty: w.specialty })), concurrency, foreman });",
         "api.setFactory({ workers: workers.map(w => ({ id: w.id, name: w.name, species: w.species, specialty: w.specialty, capability: w.capability || 'text' })), concurrency, foreman });")
js = rep(js, "    $('wdName').value = w.name; $('wdSpecies').value = w.species; $('wdSpec').value = w.specialty || '';",
         "    $('wdName').value = w.name; $('wdSpecies').value = w.species; $('wdSpec').value = w.specialty || ''; $('wdCap').value = w.capability || 'text';")
js = rep(js, "  w.name = name; w.species = $('wdSpecies').value; w.specialty = $('wdSpec').value.trim().slice(0, 1200);",
         "  w.name = name; w.species = $('wdSpecies').value; w.specialty = $('wdSpec').value.trim().slice(0, 1200); w.capability = $('wdCap').value;")
js = rep(js, "<div><b>${esc(w.name)}</b><span>${esc((w.specialty || '').split(/[.\\n]/)[0])}</span></div>",
         "<div><b>${esc(w.name)}</b><span>${CAP_LABEL[w.capability] || 'text'} · ${esc((w.specialty || '').split(/[.\\n]/)[0])}</span></div>")
js = rep(js, "<span>${TIER_LABEL[j.tierApplied || j.tier] || ''}</span>${j.simulated ? '<span>simulated</span>' : ''}",
         "<span>${TIER_LABEL[j.tierApplied || j.tier] || ''}</span>${j.kind === 'code' ? '<span>code</span>' : j.kind === 'pm' ? '<span>pm</span>' : ''}${j.pr ? `<span>PR #${j.pr.number}</span>` : ''}${j.simulated ? '<span>simulated</span>' : ''}")
js = rep(js, "  if ($('jdPrompt').textContent !== j.text) $('jdPrompt').textContent = j.text;\n  paintOutput(); paintJobActions();",
         "  if ($('jdPrompt').textContent !== j.text) $('jdPrompt').textContent = j.text;\n  paintOutput(); paintJobActions(); paintCode(j);")
js = rep(js, "function paintOutput() {\n  const j = jobById(selJob); if (!j) return;",
         "function paintOutput() {\n  const j = jobById(selJob); if (!j) return;\n  paintCode(j);")
js = rep(js, "let paintedAct = null;", r"""// Coding jobs: branch, PR, files changed and live tool steps; PM jobs: proposed tickets.
const CAP_LABEL = { text: 'text', code: 'code', pm: 'PM' };
function diffHTML(d) {
  if (!d) return '';
  return `<span>${d.files.length} file${d.files.length === 1 ? '' : 's'} changed, <b style="color:var(--ok)">+${d.insertions}</b> <b style="color:var(--crit)">−${d.deletions}</b>, ${d.commits} commit${d.commits === 1 ? '' : 's'}</span>`;
}
function prHTML(j) {
  if (j.pr) return `<a class="pr" href="${esc(j.pr.url)}" target="_blank" rel="noreferrer">PR #${j.pr.number} into dev${j.pr.merged ? ' (merged)' : ''}</a>`;
  if (j.prError) return `<span style="color:var(--warn)">${esc(j.prError)}</span>`;
  return '';
}
let paintedCode = '';
function paintCode(j) {
  const box = $('jdCode');
  if (!j || (j.kind !== 'code' && !(j.proposals && j.proposals.length))) { box.hidden = true; paintedCode = ''; return; }
  const sig = j.id + j.status + (j.steps || []).length + (j.pr ? j.pr.url + j.pr.merged : '') + (j.prError || '') + JSON.stringify((j.proposals || []).map(x => x.accepted)) + (j.diff ? j.diff.insertions + '/' + j.diff.deletions : '');
  if (sig === paintedCode) return; paintedCode = sig;
  box.hidden = false;
  let h = '';
  if (j.kind === 'code') {
    h += `<span class="label">Code</span><div class="legend"><span>${esc(j.branch || 'preparing a branch…')}</span>${diffHTML(j.diff)}</div>`;
    if (prHTML(j)) h += `<p style="margin:6px 0">${prHTML(j)}</p>`;
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
let paintedAct = null;""")
# task drawer: PR + diff per run, and on the latest output
js = rep(js, "  const sig = js.map(j => j.id + j.status + (j.output || '').length).join('|');",
         "  const sig = js.map(j => j.id + j.status + (j.output || '').length + (j.pr ? j.pr.url + j.pr.merged : '') + (j.prError || '') + (j.steps || []).length).join('|');")
js = rep(js, "<span class=\"meta\"><span>${j.startedAt ? fmtDur(runMs(j)) : 'waiting'}</span><span>≈${fmtNum(j.outTok || 0)} tok</span><span>${ago(j.createdAt)}</span></span></div>`; }).join('')}</div>` +",
         "<span class=\"meta\"><span>${j.startedAt ? fmtDur(runMs(j)) : 'waiting'}</span><span>≈${fmtNum(j.outTok || 0)} tok</span>${j.kind === 'code' && j.steps ? `<span>${j.steps.length} steps</span>` : ''}${j.diff ? `<span>+${j.diff.insertions} −${j.diff.deletions}</span>` : ''}<span>${ago(j.createdAt)}</span></span></div>${j.kind === 'code' ? `<div class=\"legend\" style=\"margin:2px 0 6px 40px\">${j.branch ? `<span>${esc(j.branch)}</span>` : ''}${prHTML(j)}</div>` : ''}`; }).join('')}</div>` +")
# board header: which folder workers can edit, and Release to prod
js = rep(js, "  renderSuggest(); renderCols();\n}", r"""  const note = $('bhRepo'), r = p.repo;
  note.hidden = !r;
  if (r) note.textContent = r.status === 'ready'
    ? `Repo ${r.url}${r.github ? '' : ' (not on GitHub: no PRs)'} · Coders edit only in git worktrees under ${repoRoot}\\worktrees\\${p.key} on feature/${p.key}-* branches cut from dev · PRs go into dev; only you release dev → prod.`
    : r.status === 'setting-up' ? `Setting up the repository from ${r.source}…` : `Repository problem: ${r.error}`;
  $('releaseBtn').hidden = !(r && r.status === 'ready');
  renderSuggest(); renderCols();
}
let repoRoot = '%USERPROFILE%\\Burrowby';
api.repoInfo().then(i => { repoRoot = i.root; if (view === 'board') renderBoard(); }).catch(() => {});
$('releaseBtn').addEventListener('click', async () => {
  const p = projectById(curProject); if (!p) return;
  const btn = $('releaseBtn'); btn.disabled = true;
  const r = await api.releaseToProd(p.id); btn.disabled = false;
  if (!r.ok) toast(r.error);
  else toast(r.result.released ? `Released ${r.result.commits} commit${r.result.commits === 1 ? '' : 's'} to prod (${r.result.sha}).` : r.result.note);
});""")
# project drawer: repository
js = rep(js, "  $('pdDelete').hidden = !p;\n", r"""  $('pdDelete').hidden = !p;
  $('pdRepo').value = p && p.repo ? p.repo.source : '';
  paintRepoNote(p);
""")
js = rep(js, "function paintSwatches() {", r"""function paintRepoNote(p) {
  const r = p && p.repo;
  $('pdRepoNote').textContent = !p ? 'Save the project first, then connect a repository.'
    : !r ? `The app clones it to ${repoRoot}\\projects\\${p.key} and makes sure prod and dev branches exist. Coders then work in worktrees under ${repoRoot}\\worktrees\\${p.key}.`
    : r.status === 'ready' ? `Clone: ${r.path} · remote ${r.url}${r.github ? '' : ' (not GitHub: branches are pushed but no PRs are opened)'}`
    : r.status === 'setting-up' ? 'Setting up…' : `Problem: ${r.error}`;
}
function paintSwatches() {""")
js = rep(js, "  if (a.dataset.act === 'close') { $('projDrawer').hidden = true; return; }\n  if (a.dataset.act === 'delete' && editingProject) {",
         r"""  if (a.dataset.act === 'close') { $('projDrawer').hidden = true; return; }
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
  if (a.dataset.act === 'delete' && editingProject) {""")

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:">
<title>Burrowby Works</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="app.css">
</head>
<body>
{markup.strip()}
<script src="app.js"></script>
</body>
</html>
"""
header = "// Burrowby Works main window. Ported from the Burrowby Works artifact: the UI,\n// factory floor, charts, board and context library are the artifact's own code.\n// Data and Claude calls go through the engine in the main process (window.works).\n"
open(os.path.join(outdir, 'app.html'), 'w', encoding='utf8').write(page)
open(os.path.join(outdir, 'app.css'), 'w', encoding='utf8').write(css.strip() + '\n')
open(os.path.join(outdir, 'app.js'), 'w', encoding='utf8').write(header + js.strip() + '\n')
print('ok', len(page), len(css), len(js))
