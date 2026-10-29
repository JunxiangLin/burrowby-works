// Dev smoke test: `npm run smoke` (add SMOKE_LIVE=1 to also run one real job
// and one foreman turn through Claude Code). Boots the real app with a
// throwaway data folder, drags the pet with synthetic mouse events, checks it
// lands on the taskbar edge and that a click opens the chat, moves the real
// cursor over the pet to check click-through, then opens the Burrowby Works
// window and walks all four sections. Screenshots go to ./smoke-out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, screen, ipcMain } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'burrowby-smoke-'))); // keep test data out of the real profile
const interactiveLog = [];
ipcMain.on('overlay:set-interactive', (_e, v) => interactiveLog.push(!!v));
const errors = [];
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(`${path.basename(wc.getURL())}: ${e.message}`); }));
require('../src/main.js');

const out = path.join(__dirname, '..', 'smoke-out');
const LIVE = process.env.SMOKE_LIVE === '1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, label) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`); };
function moveCursor(x, y) {
  const sf = screen.getPrimaryDisplay().scaleFactor;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x * sf)}, ${Math.round(y * sf)})`]);
}
const PET = 84;
const petState = (w) =>
  w.webContents.executeJavaScript(
    `(() => { const p = document.getElementById('pet'); const m = p.style.transform.replace(/[^0-9,-]/g, '').split(',').map(Number);
      return { x: m[0], y: m[1], floor: innerHeight - ${PET}, popover: !document.getElementById('popover').hidden }; })()`,
  );
const findWin = (name) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(name));

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  await wait(3500);
  const overlay = findWin('pet.html');

  // ---- desktop pet ----
  let st = await petState(overlay);
  check(st.y === st.floor, `pet dropped onto the taskbar edge (y=${st.y}, floor=${st.floor})`);
  const cx = st.x + PET / 2, cy = st.y + PET / 2;
  const send = (type, x, y) => overlay.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  send('mouseMove', cx, cy);
  send('mouseDown', cx, cy);
  for (let i = 1; i <= 10; i++) { send('mouseMove', cx - i * 30, cy - i * 40); await wait(16); }
  const mid = await petState(overlay);
  check(mid.y < st.y - 200, `drag lifts the pet (y=${mid.y})`);
  send('mouseUp', cx - 300, cy - 400);
  await wait(2200);
  st = await petState(overlay);
  check(st.y === st.floor, 'pet falls back to the taskbar edge after release');
  send('mouseMove', st.x + PET / 2, st.y + PET / 2);
  send('mouseDown', st.x + PET / 2, st.y + PET / 2);
  send('mouseUp', st.x + PET / 2, st.y + PET / 2);
  await wait(400);
  check((await petState(overlay)).popover, 'click opens the chat popover');
  await overlay.webContents.executeJavaScript("document.getElementById('btn-close').click()");

  const home = screen.getCursorScreenPoint();
  const wa = screen.getPrimaryDisplay().workArea;
  await overlay.webContents.executeJavaScript("window.petApi && 0"); // no-op; keeps ordering
  st = await petState(overlay);
  moveCursor(wa.x + st.x + 400, wa.y + 200);
  await wait(500);
  interactiveLog.length = 0;
  st = await petState(overlay);
  moveCursor(wa.x + st.x + PET / 2, wa.y + st.y + PET - 20);
  await wait(500);
  const overPet = interactiveLog.includes(true);
  moveCursor(wa.x + st.x + 400, wa.y + 200);
  await wait(500);
  const away = interactiveLog[interactiveLog.length - 1] === false;
  moveCursor(home.x, home.y);
  check(overPet && away, `click-through toggles with hover ${JSON.stringify(interactiveLog)}`);

  // ---- main window, opened the way the popover's "Open app" does ----
  await overlay.webContents.executeJavaScript("window.works.openApp('factory')");
  await wait(2500);
  const main = findWin('app.html');
  check(!!main, 'Open app opens the Burrowby Works window');
  const js = (code) => main.webContents.executeJavaScript(code);
  const offsets = [];
  for (const v of ['assistant', 'factory', 'board', 'context']) {
    await js(`document.querySelector('.views [data-view="${v}"]').click()`);
    await wait(600);
    const info = await js(`(() => { const r = document.querySelector('.views').getBoundingClientRect(); return { off: Math.round(r.left + r.width / 2 - document.documentElement.clientWidth / 2), shown: [...document.querySelectorAll('main')].every((m) => (getComputedStyle(m).display !== 'none') === (m.id === 'view-${v}')), drawers: [...document.querySelectorAll('.drawer')].every((d) => getComputedStyle(d).display === 'none') }; })()`);
    offsets.push(info.off);
    check(info.shown && info.drawers, `${v} section is the only one visible, drawers closed`);
    fs.writeFileSync(path.join(out, `app-${v}.png`), (await main.webContents.capturePage()).toPNG());
  }
  check(offsets.every((o) => Math.abs(o) <= 1) && new Set(offsets).size === 1, `section switcher stays centered (offsets ${offsets.join(', ')})`);

  // Board: sample project; Context: its two entries.
  await js(`document.querySelector('.views [data-view="board"]').click()`);
  await js(`document.querySelector('[data-act="sample-project"]').click()`);
  await wait(800);
  const cards = await js(`document.querySelectorAll('.tcard').length`);
  check(cards === 5, `sample project adds 5 task cards (${cards})`);
  fs.writeFileSync(path.join(out, 'app-board-sample.png'), (await main.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.views [data-view="context"]').click()`);
  await wait(400);
  check((await js(`document.querySelectorAll('#ctxList .entry').length`)) === 2, 'context library lists the sample entries');

  if (LIVE) {
    // Factory: assign a quick job through the form and watch it stream.
    await js(`document.querySelector('.views [data-view="factory"]').click()`);
    await js(`document.getElementById('jobText').value = 'Reply with exactly three words about hard hats.'; document.getElementById('jobTier').value = 'quick'; document.getElementById('assign').requestSubmit();`);
    let job = null;
    for (let i = 0; i < 90; i++) {
      await wait(1000);
      job = (await overlay.webContents.executeJavaScript('window.works.getState()')).jobs.slice(-1)[0];
      if (job && !['queued', 'running'].includes(job.status)) break;
    }
    check(job && job.status === 'done' && job.firstTokenAt > 0, `live job shipped with time to first token (${job && job.status}, ttft ${job && job.firstTokenAt - job.startedAt} ms, output ${JSON.stringify(job && job.output)})`);
    await js(`document.querySelector('.tabs [data-tab="overview"]').click()`);
    await wait(800);
    fs.writeFileSync(path.join(out, 'app-factory-live.png'), (await main.webContents.capturePage()).toPNG());
    // Assistant: one foreman turn; the pet popover shares the conversation.
    await js(`document.querySelector('.views [data-view="assistant"]').click(); document.getElementById('chatInput').value = 'What is everyone working on? Answer in one sentence.'; document.getElementById('chatForm').requestSubmit();`);
    let chat = [];
    for (let i = 0; i < 120; i++) {
      await wait(1000);
      const s = await overlay.webContents.executeJavaScript('window.works.getState()');
      chat = s.chat;
      if (!s.chatBusy && chat.length >= 2) break;
    }
    const reply = chat[chat.length - 1];
    check(reply && reply.role === 'assistant' && !reply.error && reply.text.length > 5, `foreman replied: ${JSON.stringify(reply && reply.text)}`);
    await wait(500);
    fs.writeFileSync(path.join(out, 'app-assistant-live.png'), (await main.webContents.capturePage()).toPNG());
  }

  check(errors.length === 0, `no renderer errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME CHECKS FAILED');
  app.exit(results.every(Boolean) ? 0 : 1);
});
