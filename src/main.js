// Electron main process: owns the Burrowby Works engine (factory data, job
// runner, foreman), the desktop-pet overlay, the main Burrowby Works window,
// the settings window and the tray icon.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, shell, dialog, Notification } = require('electron');
const { Store } = require('./store');
const { execFile } = require('child_process');
const { Engine, SPECIES } = require('./engine');
const { Repos } = require('./repos');
const cli = require('./cli');
const { Updater, installScript, planRestart } = require('./updater');
const { buildDigest } = require('./digest');

// The GitHub CLI may be installed after the app started, so look it up on each call.
function ghExe() {
  const candidates = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')];
  return candidates.find((c) => fs.existsSync(c)) || 'gh';
}
function runGh(args, { cwd, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ghExe(), args, { cwd, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(`gh ${args[0]}: ${(stderr || err.message).toString().trim().split('\n').slice(-3).join(' ')}`), { code: err.code }));
      resolve(stdout.toString());
    });
  });
}

// A second launch just pokes the running pet instead of spawning another one.
if (!app.requestSingleInstanceLock()) app.exit(0);

let overlay = null;
let appWin = null;
let settingsWin = null;
let tray = null;
let store, engine;
let claudeExe = null; // resolved path to claude.exe, or null
let cliStatus = { ready: false, message: 'Checking Claude Code…' };

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

function broadcast(channel, payload) {
  for (const w of [overlay, appWin, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
const sendToOverlay = (channel, payload) => overlay && !overlay.isDestroyed() && overlay.webContents.send(channel, payload);

function refreshClaude() {
  const override = store.getConfig().claudePath || null;
  claudeExe = cli.findClaude(override);
  const st = cli.status(override);
  cliStatus = {
    ...st,
    ready: !!(st.found && st.loggedIn),
    message: !st.found
      ? 'Claude Code (claude.exe) was not found. Install it and sign in.'
      : !st.loggedIn
        ? 'Claude Code is installed but not signed in. Run `claude` in a terminal and sign in.'
        : `Claude Code is signed in${st.email ? ` as ${st.email}` : ''}.`,
  };
  broadcast('cli-status', cliStatus);
  engine?.schedule();
  return cliStatus;
}

// ---------- windows ----------
// The overlay covers the primary display's work area (everything except the
// taskbar), so the bottom of the window is the taskbar edge the pet stands on.
function fitOverlay() {
  if (!overlay) return;
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  overlay.setBounds({ x, y, width, height });
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...screen.getPrimaryDisplay().workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: webPreferences(),
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // Click-through by default; the renderer turns it off while the cursor is
  // over the pet or its chat. `forward` keeps mousemove events flowing so it can tell.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'pet.html'));

  // Backup for forwarded mouse events: poll the cursor so the renderer can
  // hit-test even when Windows stops forwarding moves to an ignored window, or
  // when the pet walks under a still cursor.
  const poll = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return clearInterval(poll);
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    sendToOverlay('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 60);
  overlay.once('ready-to-show', () => overlay.showInactive());
  // PR links in the pet's job list open in the browser.
  overlay.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  overlay.on('closed', () => (overlay = null));

  screen.on('display-metrics-changed', fitOverlay);
  screen.on('display-added', fitOverlay);
  screen.on('display-removed', fitOverlay);
}

function openApp(view) {
  if (appWin && !appWin.isDestroyed()) {
    if (appWin.isMinimized()) appWin.restore();
    appWin.show();
    appWin.focus();
    if (view) appWin.webContents.send('show-view', view);
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  appWin = new BrowserWindow({
    width: Math.min(1440, wa.width - 80),
    height: Math.min(920, wa.height - 60),
    minWidth: 720,
    minHeight: 520,
    title: 'Burrowby Works',
    autoHideMenuBar: true,
    backgroundColor: '#F6F1E7',
    show: false,
    webPreferences: webPreferences(),
  });
  appWin.loadFile(path.join(__dirname, 'renderer', 'app.html'));
  appWin.once('ready-to-show', () => {
    appWin.show();
    if (view) appWin.webContents.send('show-view', view);
  });
  // Links in job output open in the default browser, never inside the app.
  appWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  appWin.on('closed', () => (appWin = null));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 720,
    title: 'Burrowby Works — Settings',
    autoHideMenuBar: true,
    resizable: true,
    webPreferences: webPreferences(),
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => (settingsWin = null));
}

// A tiny procedurally drawn tray icon (orange hard hat), so no asset file is needed.
function trayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 15.5;
      const dy = y - 17.5;
      const inDome = dy <= 2 && dx * dx + dy * dy <= 13 * 13;
      const inBrim = y >= 19 && y <= 23 && x >= 1 && x <= 30;
      const i = (y * size + x) * 4;
      if (inDome || inBrim) {
        // BGRA, #FF8A3D (the foreman's orange hat)
        buf[i] = 0x3d;
        buf[i + 1] = 0x8a;
        buf[i + 2] = 0xff;
        buf[i + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function petMenu() {
  const config = store.getConfig();
  const foreman = engine.foreman;
  const upd = updateMenuItems();
  return Menu.buildFromTemplate([
    ...upd,
    ...(upd.length ? [{ type: 'separator' }] : []),
    { label: 'Open chat', click: () => sendToOverlay('open-chat') },
    { label: 'Show daily digest', click: () => sendToOverlay('digest', makeDigest()) },
    { label: 'Open Burrowby Works', click: () => openApp() },
    {
      label: 'Go to',
      submenu: [['assistant', 'Assistant'], ['factory', 'Factory'], ['board', 'Board'], ['context', 'Context']].map(([v, l]) => ({ label: l, click: () => openApp(v) })),
    },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    {
      label: `Foreman (${foreman.name})`,
      submenu: SPECIES.map((sp) => ({
        label: sp[0].toUpperCase() + sp.slice(1),
        type: 'radio',
        checked: foreman.species === sp,
        click: () => engine.setForeman({ species: sp }),
      })),
    },
    {
      label: 'Roam around',
      type: 'checkbox',
      checked: config.roam,
      click: (item) => {
        store.saveConfig({ roam: item.checked });
        broadcast('config', store.getConfig());
      },
    },
    { label: 'Bring pet back', click: () => sendToOverlay('reset-position') },
    { type: 'separator' },
    { label: 'Stop all jobs', click: () => engine.stopAll() },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

// ---------- import / export ----------
async function importFromFile(parent) {
  const pick = await dialog.showOpenDialog(parent, {
    title: 'Import from Burrowby Works',
    filters: [{ name: 'Burrowby Works export', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
  let data, counts;
  try {
    data = JSON.parse(fs.readFileSync(pick.filePaths[0], 'utf8'));
    counts = Engine.validateImport(data);
  } catch (err) {
    return { ok: false, error: err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message };
  }
  const summary = `${counts.jobs} jobs, ${counts.projects} projects, ${counts.tasks} tasks, ${counts.contexts} context entries, ${counts.workers} workers, ${counts.chat} chat messages`;
  let mode = 'replace';
  if (engine.hasData()) {
    const r = await dialog.showMessageBox(parent, {
      type: 'question',
      title: 'Import from Burrowby Works',
      message: 'You already have data in the desktop app.',
      detail: `The file has ${summary}.\n\nMerge keeps your local data and adds the imported items (items with the same id are replaced by the imported copy). Replace deletes your local data first.`,
      buttons: ['Merge', 'Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (r.response === 2) return { ok: false, canceled: true };
    mode = r.response === 0 ? 'merge' : 'replace';
  }
  engine.importData(data, mode);
  return { ok: true, mode, summary };
}

async function exportToFile(parent) {
  const d = new Date();
  const name = `burrowby-works-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const r = await dialog.showSaveDialog(parent, { title: 'Export Burrowby Works data', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(engine.exportDoc(), null, 2));
  return { ok: true, path: r.filePath };
}

async function exportAuditToFile(parent, taskId) {
  const text = engine.auditText(taskId);
  if (text == null) return { ok: false };
  const t = engine.taskById(taskId);
  const r = await dialog.showSaveDialog(parent, { title: 'Export audit trail', defaultPath: path.join(app.getPath('documents'), `${engine.taskKey(t)}-audit.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, text);
  return { ok: true, path: r.filePath };
}

// ---------- IPC ----------
// ---------- self-update ----------
// The app keeps its own folder (app.getAppPath(), a checkout of prod) at origin/prod:
// after a Release to prod, at startup and every 10 minutes. See src/updater.js.
let updater = null;
let updateStatus = { state: 'unknown' };
let lastNotifiedRemote = null;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function describeUpdate(st) {
  switch (st.state) {
    case 'up-to-date': return { text: `Burrowby Works is up to date (${st.head}).`, actions: ['check'], show: false };
    case 'available': return { text: `Update available: ${st.head} → ${st.remote} (${plural(st.behind, 'change')}).`, actions: ['apply'], show: true };
    case 'updating': return { text: 'Updating Burrowby Works…', actions: [], show: true };
    case 'ready': return { text: `Updated to ${st.to} (${plural(st.changes, 'change')}). Restart now?${st.needsInstall ? ' Dependencies changed, so npm ci runs while the app restarts.' : ''}`, actions: ['restart', 'later'], show: true };
    case 'restarting': return { text: `Restarting after ${plural(st.waitFor, 'running job')} finish${st.waitFor === 1 ? 'es' : ''}. New jobs wait until after the restart; queued jobs stay queued.`, actions: ['cancel'], show: true };
    case 'blocked': return { text: `Can't update the app automatically: ${st.message}`, actions: ['check'], show: !!(st.afterRelease || st.behind > 0) };
    case 'error': return { text: `Update problem: ${st.message}`, actions: ['check'], show: true };
    default: return { text: 'Update status unknown.', actions: ['check'], show: false };
  }
}

function setUpdateStatus(st) {
  updateStatus = { ...st, ...describeUpdate(st), dir: updater ? updater.dir : app.getAppPath(), at: Date.now() };
  broadcast('update:status', updateStatus);
  // Tell the pet once per new prod commit, and whenever an update is ready.
  const key = `${st.state}:${st.remote || st.to || st.reason || ''}`;
  if (updateStatus.show && ['available', 'ready', 'blocked', 'error'].includes(st.state) && key !== lastNotifiedRemote) {
    lastNotifiedRemote = key;
    broadcast('works:notice', { kind: 'update', text: updateStatus.text });
  }
  return updateStatus;
}

const busyUpdating = () => ['updating', 'ready', 'restarting'].includes(updateStatus.state);

async function checkForUpdate() {
  if (!updater || busyUpdating()) return updateStatus;
  try { return setUpdateStatus(await updater.inspect()); } catch (err) { return setUpdateStatus({ state: 'error', message: err.message }); }
}

async function applyUpdate({ afterRelease = false } = {}) {
  if (!updater || busyUpdating()) return updateStatus;
  setUpdateStatus({ state: 'updating' });
  try {
    const r = await updater.update();
    // A release of some other project leaves the app folder up to date: say nothing.
    return setUpdateStatus(r.state === 'blocked' ? { ...r, afterRelease } : r);
  } catch (err) {
    return setUpdateStatus({ state: 'error', message: err.message });
  }
}

// Restart into the new version. Running jobs finish first (no new ones start);
// queued jobs are saved and resume after the restart.
let restartWatch = null;
function restartForUpdate() {
  if (updateStatus.state !== 'ready' && updateStatus.state !== 'restarting') return updateStatus;
  const ready = updateStatus.state === 'ready' ? updateStatus : updateStatus.ready;
  const plan = planRestart({ running: engine.runningCount(), needsInstall: !!ready.needsInstall });
  if (plan.waitFor > 0) {
    engine.holdNewJobs(true);
    clearInterval(restartWatch);
    restartWatch = setInterval(() => {
      const n = engine.runningCount();
      if (n === 0) { clearInterval(restartWatch); doRestart(plan); } else if (n !== updateStatus.waitFor) setUpdateStatus({ state: 'restarting', waitFor: n, ready });
    }, 2000);
    return setUpdateStatus({ state: 'restarting', waitFor: plan.waitFor, ready });
  }
  doRestart(plan);
  return updateStatus;
}

function cancelRestart() {
  if (updateStatus.state !== 'restarting') return updateStatus;
  clearInterval(restartWatch);
  engine.holdNewJobs(false);
  return setUpdateStatus(updateStatus.ready);
}

function doRestart(plan) {
  engine.saveNow(); // app.exit() skips before-quit
  if (plan.mode === 'install-then-launch') {
    // npm ci must not run while electron.exe is in use: a helper waits for this
    // process to exit, installs, checks the shortcut's electron.exe, and relaunches.
    const ps1 = path.join(app.getPath('userData'), 'update-install.ps1');
    const logFile = path.join(app.getPath('userData'), 'update-install.log');
    fs.writeFileSync(ps1, installScript({ pid: process.pid, dir: updater.dir, electronPath: process.execPath, logFile }));
    const { spawn } = require('child_process');
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    app.relaunch();
  }
  app.exit(0);
}

function updateMenuItems() {
  const st = updateStatus;
  if (st.state === 'available') return [{ label: `Update Burrowby Works (${plural(st.behind, 'change')})`, click: () => applyUpdate() }];
  if (st.state === 'ready') return [{ label: `Restart to finish the update (${st.to})`, click: () => restartForUpdate() }];
  if (st.state === 'restarting') return [{ label: `Cancel restart (waiting for ${plural(st.waitFor, 'job')})`, click: () => cancelRestart() }];
  if (st.state === 'blocked' && st.show) return [{ label: "Update blocked: see Settings", click: openSettings }];
  return [];
}

function registerIpc() {
  const win = (e) => BrowserWindow.fromWebContents(e.sender);

  // Overlay window
  ipcMain.on('overlay:set-interactive', (_e, interactive) => {
    if (!overlay) return;
    if (interactive) overlay.setIgnoreMouseEvents(false);
    else overlay.setIgnoreMouseEvents(true, { forward: true });
  });
  ipcMain.on('overlay:focus', () => overlay?.focus());
  ipcMain.on('pet:menu', () => petMenu().popup({ window: overlay }));
  ipcMain.on('settings:open', openSettings);
  ipcMain.on('app:open', (_e, view) => openApp(view));
  ipcMain.on('pet:command', (_e, cmd) => { if (cmd === 'reset') sendToOverlay('reset-position'); });
  ipcMain.handle('config:get', () => store.getConfig());

  // Shared factory (pet overlay + main window)
  ipcMain.handle('works:state', () => engine.snapshot());
  ipcMain.handle('works:cli-status', () => cliStatus);
  ipcMain.handle('works:digest', () => makeDigest());
  ipcMain.handle('works:create-job', (_e, { text, pref, tier, extra }) => engine.createJob(String(text || ''), pref || 'any', tier || 'default', {
    ...(extra && extra.projectId ? { projectId: extra.projectId } : {}),
    ...(extra && Array.isArray(extra.ctx) ? { ctx: extra.ctx } : {}),
  }));
  ipcMain.handle('works:stop-job', (_e, id) => engine.stopJob(id));
  ipcMain.handle('works:retry-job', (_e, id) => engine.retryJob(id));
  ipcMain.handle('works:delete-jobs', (_e, ids) => engine.deleteJobs(ids || []));
  ipcMain.handle('works:clear-finished', () => engine.clearFinished());
  ipcMain.handle('works:set-factory', (_e, f) => engine.setFactory(f || {}));
  ipcMain.handle('works:retire-worker', (_e, id) => engine.retireWorker(id));
  ipcMain.handle('works:upsert', (_e, coll, obj) => engine.upsert(coll, obj));
  ipcMain.handle('works:remove', (_e, coll, id) => engine.remove(coll, id));
  ipcMain.handle('works:send-task', (_e, id) => engine.sendTask(id));
  ipcMain.handle('works:export-audit', (e, id) => exportAuditToFile(win(e), String(id)));
  ipcMain.handle('works:sample-project', () => engine.sampleProject());
  ipcMain.handle('works:suggest-tasks', (_e, id) => engine.suggestTasks(id));
  ipcMain.handle('works:ask', (_e, text) => engine.askForeman(text));
  ipcMain.handle('works:stop-foreman', () => engine.stopForeman());
  ipcMain.handle('works:clear-chat', () => engine.clearChat());
  ipcMain.handle('works:export', (e) => exportToFile(win(e)));
  ipcMain.handle('works:stop-all', () => engine.stopAll());
  ipcMain.handle('works:accept-proposals', (_e, jobId, picks) => engine.acceptProposals(jobId, picks));
  // Repo actions report errors as values so the window can show them.
  const safe = (fn) => async (...args) => { try { return { ok: true, result: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('works:set-repo', safe((_e, projectId, source) => engine.setProjectRepo(projectId, source)));
  ipcMain.handle('works:list-prs', safe((_e, projectId) => engine.listPrs(projectId)));
  ipcMain.handle('works:merge-pr', safe((_e, projectId, number) => engine.mergePr(projectId, number)));
  ipcMain.handle('works:release-preview', safe((_e, projectId) => engine.releasePreview(projectId)));
  ipcMain.handle('works:release', safe(async (e, projectId) => {
    const p = engine.projectById(projectId);
    if (!p) throw new Error('No such project.');
    // Always preview against freshly fetched refs, then confirm exactly that.
    const pv = await engine.releasePreview(projectId);
    if (pv.diverged) throw new Error(pv.summary);
    if (!pv.ahead) return { released: false, note: pv.summary };
    const lines = pv.commits.slice(0, 12).map((c) => `• ${c.sha} ${c.subject}`).join('\n') + (pv.commits.length > 12 ? `\n• …and ${pv.commits.length - 12} more` : '');
    const r = await dialog.showMessageBox(win(e), {
      type: 'warning', title: 'Release to prod',
      message: `Release ${p.key}: ship ${pv.ahead} commit${pv.ahead === 1 ? '' : 's'}${pv.prs.length ? ` (PR${pv.prs.length === 1 ? '' : 's'} ${pv.prs.map((n) => `#${n}`).join(', ')})` : ''} to prod?`,
      detail: `prod ${pv.prod} → ${pv.dev} (fast-forward to the current dev).\n\n${lines}\n\nOnly you can do this; workers and the foreman cannot.`,
      buttons: ['Release', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (r.response !== 0) return { released: false, note: 'Canceled. Nothing was released.' };
    const rel = await engine.releaseToProd(projectId, pv.devSha);
    // If this release changed the app's own repository, the app's folder is now behind.
    if (rel.released) setTimeout(() => applyUpdate({ afterRelease: true }), 1500);
    return rel;
  }));
  ipcMain.handle('update:get', () => updateStatus);
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:apply', () => applyUpdate());
  ipcMain.handle('update:restart', () => restartForUpdate());
  ipcMain.handle('update:cancel', () => cancelRestart());
  ipcMain.handle('works:repo-info', async () => ({ root: engine.repos.root, appDir: engine.repos.appDir, gh: await engine.repos.ghStatus() }));

  // Settings window
  ipcMain.handle('settings:status', () => ({ cli: cliStatus, config: store.getConfig(), dataDir: store.dir, foreman: engine.foreman, version: app.getVersion() }));
  ipcMain.handle('settings:recheck', () => refreshClaude());
  ipcMain.handle('settings:save-config', (_e, patch) => {
    const allowed = {};
    for (const k of ['model', 'quickModel', 'deepModel']) if (typeof patch?.[k] === 'string' && patch[k].trim()) allowed[k] = patch[k].trim();
    if (typeof patch?.roam === 'boolean') allowed.roam = patch.roam;
    if (typeof patch?.notifyJobs === 'boolean') allowed.notifyJobs = patch.notifyJobs;
    if (typeof patch?.claudePath === 'string') allowed.claudePath = patch.claudePath.trim();
    const config = store.saveConfig(allowed);
    if ('claudePath' in allowed) refreshClaude();
    broadcast('config', config);
    return config;
  });
  ipcMain.handle('settings:set-foreman', (_e, f) => engine.setForeman(f || {}));
  ipcMain.handle('settings:import', (e) => importFromFile(win(e)));
  ipcMain.handle('settings:open-data', () => shell.openPath(store.dir));
}

// Desktop notification when a pet finishes or fails a job; clicking it opens
// and focuses the app window. Controlled by the notifyJobs setting.
const liveNotifications = new Set(); // keep references so click handlers are not garbage collected
function notifyJobFinished({ pet, title, status }) {
  if (store.getConfig().notifyJobs === false || !Notification.isSupported()) return;
  const n = new Notification({
    title: status === 'done' ? `${pet} finished a job` : `${pet} failed a job`,
    body: `${title}\nStatus: ${status === 'done' ? 'Done' : 'Failed'}`,
  });
  liveNotifications.add(n);
  n.on('click', () => openApp('factory'));
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

function makeDigest() {
  return buildDigest({ jobs: engine.jobs, tasks: engine.tasks, taskKey: (t) => engine.taskKey(t) });
}

app.on('second-instance', () => sendToOverlay('open-chat'));

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'data'));
  engine = new Engine({
    dir: store.dir,
    // Workers edit only in worktrees under %USERPROFILE%\Burrowby, never in the folder this app runs from.
    repos: new Repos({ appDir: app.getAppPath(), gh: runGh }),
    claude: {
      exe: () => claudeExe,
      modelFor: (tier) => {
        const c = store.getConfig();
        return tier === 'quick' ? c.quickModel : tier === 'complex' ? c.deepModel : c.model;
      },
      run: cli.run,
      stream: cli.stream,
      cwd: store.dir,
    },
  });
  updater = new Updater({ dir: app.getAppPath(), electronPath: process.execPath });
  setTimeout(checkForUpdate, 20000);
  setInterval(checkForUpdate, 10 * 60 * 1000);
  engine.on('patch', (p) => broadcast('works:patch', p));
  engine.on('reset', (s) => broadcast('works:reset', s));
  engine.on('notice', (n) => broadcast('works:notice', n));
  engine.on('job-finished', notifyJobFinished);
  registerIpc();
  createOverlay();
  // Daily digest: check hourly, send at most one per 24h (also on startup if one is due).
  const dailyDigest = () => {
    const last = store.getConfig().lastDigestAt || 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    store.saveConfig({ lastDigestAt: Date.now() });
    const d = makeDigest();
    if (!d.empty) sendToOverlay('digest', d);
  };
  setTimeout(dailyDigest, 15000);
  setInterval(dailyDigest, 3600 * 1000);
  refreshClaude();

  tray = new Tray(trayIcon());
  tray.setToolTip('Burrowby Works');
  tray.on('click', () => sendToOverlay('open-chat'));
  tray.on('double-click', () => openApp());
  tray.on('right-click', () => tray.popUpContextMenu(petMenu()));

  if (!cliStatus.ready) openSettings();
});

app.on('before-quit', () => engine?.saveNow());

// Keep running in the tray when the other windows close.
app.on('window-all-closed', () => {});
