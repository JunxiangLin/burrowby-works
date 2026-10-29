// Desktop pet: the Burrowby Works foreman. It roams along the bottom of the
// screen (the taskbar edge), sits and blinks, gets dragged and thrown, falls
// back down, and opens the shared foreman chat on click.
(() => {
  const { drawPet, ell, esc, md } = window.Burrowby;
  const works = window.works;
  const pet = window.petApi;

  const SIZE = 84;
  const SCALE = 2.15; // drawPet units -> CSS px
  const WALK_SPEED = 55; // px/s
  const GRAVITY = 2200; // px/s²
  const DRAG_THRESHOLD = 5;
  const HAT = { hat: '#FF8A3D', hatLine: '#D9652A', boss: true }; // the foreman's orange hat + clipboard
  const STATUS = { queued: ['queued', 'var(--s-wait)'], running: ['running', 'var(--s-think)'], done: ['shipped', 'var(--ok)'], failed: ['failed', 'var(--crit)'], cancelled: ['stopped', 'var(--s-idle)'] };

  const $ = (id) => document.getElementById(id);
  const cv = $('pet');
  const cx = cv.getContext('2d');
  const bubbleEl = $('bubble');
  const popEl = $('popover');
  const messagesEl = $('messages');
  const inputEl = $('input');

  let config = { roam: true };
  let state = { factory: { foreman: { name: 'Marmalade', species: 'cat' }, workers: [] }, jobs: [], chat: [], chatBusy: false };
  const s = { x: Math.max(0, innerWidth / 2 - SIZE / 2), y: -SIZE, vx: 0, vy: 0, face: 1, mode: 'fall', timer: 0, phase: 0, blinkAt: 2, blinkT: 0, land: 0, sitFor: 0 };
  let chatOpen = false;
  let tab = 'chat';
  let openJobId = null;

  const floorY = () => innerHeight - SIZE;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const foreman = () => state.factory.foreman;
  const byWorker = (id) => state.factory.workers.find((w) => w.id === id);

  // ---------- drawing (the artifact's drawForeman) ----------
  let rt = 0;
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== SIZE * dpr) { cv.width = SIZE * dpr; cv.height = SIZE * dpr; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, SIZE, SIZE);
    let bob = 0, sx = 1, sy = 1;
    const mood = s.mode === 'drag' ? 'held' : s.land > 0 ? 'land' : s.mode;
    if (mood === 'walk') { const k = Math.abs(Math.sin(s.phase)); bob = -k * 3; sx = 1 + (1 - k) * 0.05; sy = 1 - (1 - k) * 0.05; }
    else if (mood === 'fall') { sx = 0.94; sy = 1.08; }
    else if (mood === 'land') { sx = 1.12; sy = 0.86; }
    else if (mood === 'held') { bob = Math.sin(rt * 12) * 1.2; }
    else { const br = Math.sin(rt * 2.4) * 0.035; sy = 1 + br; sx = 1 - br; }
    const x = SIZE / 2, y = SIZE - 5;
    cx.fillStyle = 'rgba(40,30,20,.18)';
    ell(cx, x, y + 1, 13 * SCALE * (mood === 'fall' || mood === 'held' ? 0.6 : 1), 3.6 * SCALE);
    cx.fill();
    const sleepy = s.mode === 'idle' && s.sitFor > 6 && Math.sin(rt * 0.5) > 0.6;
    drawPet(cx, foreman().species, x, y, { scale: SCALE, bob, sx, sy, face: s.face, blink: s.blinkT > 0, sleep: sleepy, focus: state.chatBusy, ...HAT });
    if (state.chatBusy) for (let i = 0; i < 3; i++) { const o = Math.sin(rt * 6 - i * 0.8) * 1.5; cx.fillStyle = '#FF8A3D'; ell(cx, x - 6 + i * 6, 8 + o, 2.4, 2.4); cx.fill(); }
  }

  let avatarKey = '', avatarUrl = '';
  function avatar() {
    if (avatarKey !== foreman().species) {
      avatarKey = foreman().species;
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      drawPet(c.getContext('2d'), avatarKey, 48, 86, { scale: 2.45, ...HAT });
      avatarUrl = c.toDataURL();
    }
    return avatarUrl;
  }

  function setMode(mode, duration = 0) {
    s.mode = mode;
    s.timer = duration;
    s.sitFor = 0;
    cv.classList.toggle('held', mode === 'drag');
  }

  // ---------- physics loop ----------
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    rt = now / 1000;
    const maxX = innerWidth - SIZE;
    s.blinkAt -= dt;
    if (s.blinkAt <= 0) { s.blinkT = 0.14; s.blinkAt = rand(2, 5); }
    if (s.blinkT > 0) s.blinkT -= dt;
    if (s.land > 0) s.land -= dt;

    if (s.mode === 'walk') {
      s.phase += dt * 10;
      s.x += s.face * WALK_SPEED * dt;
      if (s.x <= 0 || s.x >= maxX) { s.x = clamp(s.x, 0, maxX); s.face *= -1; }
      s.y = floorY();
      s.timer -= dt;
      if (chatOpen || !config.roam) setMode('idle', 1e9);
      else if (state.chatBusy) setMode('idle', 0.8);
      else if (s.timer <= 0) setMode('idle', rand(3, 9));
    } else if (s.mode === 'idle') {
      if (s.y < floorY()) setMode('fall'); // floor moved (e.g. resolution change)
      s.y = Math.min(s.y, floorY());
      s.timer -= dt;
      s.sitFor += dt;
      if (s.timer <= 0 && !chatOpen && config.roam && !state.chatBusy) {
        if (Math.random() < 0.6) s.face = Math.random() < 0.5 ? -1 : 1;
        setMode('walk', rand(4, 11));
      }
    } else if (s.mode === 'fall') {
      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.6, dt);
      if (s.x <= 0 || s.x >= maxX) { s.x = clamp(s.x, 0, maxX); s.vx = -s.vx * 0.5; }
      if (s.y >= floorY()) {
        s.y = floorY();
        if (s.vy > 650) s.vy = -s.vy * 0.3; // small bounce
        else { s.vx = 0; s.vy = 0; s.land = 0.22; setMode('idle', rand(1.5, 4)); }
      }
    }
    if (s.vx) s.face = s.vx < 0 ? -1 : 1;

    cv.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    draw();
    placeOverlays();
    requestAnimationFrame(tick);
  }

  function placeOverlays() {
    if (chatOpen) {
      const w = popEl.offsetWidth, h = popEl.offsetHeight;
      let left = s.x + SIZE / 2 - w / 2;
      let top = s.y - h - 8;
      if (top < 8) {
        top = clamp(s.y + SIZE / 2 - h / 2, 8, innerHeight - h - 8);
        left = s.x + SIZE + 10 + w > innerWidth ? s.x - w - 10 : s.x + SIZE + 10;
      }
      popEl.style.transform = `translate(${Math.round(clamp(left, 8, innerWidth - w - 8))}px, ${Math.round(top)}px)`;
    }
    if (!bubbleEl.hidden) {
      const w = bubbleEl.offsetWidth, h = bubbleEl.offsetHeight;
      bubbleEl.style.transform = `translate(${Math.round(clamp(s.x + SIZE / 2 - w / 2, 8, innerWidth - w - 8))}px, ${Math.round(Math.max(8, s.y - h - 2))}px)`;
    }
  }

  // ---------- click-through ----------
  // The window ignores the mouse except over the pet, bubble and popover.
  let interactive = false;
  let press = null;
  function setInteractive(value) {
    if (value === interactive) return;
    interactive = value;
    pet.setInteractive(value);
  }
  function updateHit(x, y) {
    if (s.mode === 'drag' || press) return setInteractive(true);
    const el = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
    setInteractive(!!(el && el.closest('#pet, #popover, #bubble')));
  }
  document.addEventListener('mousemove', (e) => updateHit(e.clientX, e.clientY));
  pet.onCursor((p) => updateHit(p.x, p.y));

  // ---------- drag / click ----------
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    press = { sx: e.clientX, sy: e.clientY, ox: e.clientX - s.x, oy: e.clientY - s.y, moved: false, trail: [] };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > DRAG_THRESHOLD) {
      press.moved = true;
      setMode('drag');
      setInteractive(true);
    }
    if (press.moved) {
      s.x = clamp(e.clientX - press.ox, 0, innerWidth - SIZE);
      s.y = clamp(e.clientY - press.oy, 0, floorY());
      press.trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (press.trail.length > 6) press.trail.shift();
    }
  });
  function endPress(e) {
    if (!press) return;
    const p = press;
    press = null;
    if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    if (p.moved) {
      // Throw with the velocity of the last few pointer moves, then fall to the floor.
      const a = p.trail[0], b = p.trail[p.trail.length - 1];
      const dt = a && b ? Math.max(16, b.t - a.t) / 1000 : 1;
      s.vx = a && b ? clamp((b.x - a.x) / dt, -1500, 1500) : 0;
      s.vy = a && b ? clamp((b.y - a.y) / dt, -1500, 1500) : 0;
      setMode('fall');
    } else if (e.type === 'pointerup') {
      toggleChat();
    }
  }
  cv.addEventListener('pointerup', endPress);
  cv.addEventListener('pointercancel', endPress);
  cv.addEventListener('lostpointercapture', endPress); // never get stuck holding the pet
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); pet.showMenu(); });

  // ---------- bubble (the artifact's roamSay) ----------
  let bubbleTimer = null;
  function say(text, thinking) {
    if (chatOpen) return;
    clearTimeout(bubbleTimer);
    if (thinking) bubbleEl.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    else {
      const t = String(text || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
      bubbleEl.textContent = t.length > 140 ? t.slice(0, 140) + '…' : t;
      bubbleTimer = setTimeout(() => (bubbleEl.hidden = true), 8000);
    }
    bubbleEl.hidden = false;
  }
  bubbleEl.addEventListener('click', () => { bubbleEl.hidden = true; openChat(); });

  // ---------- chat popover ----------
  function openChat(which = tab) {
    chatOpen = true;
    popEl.hidden = false;
    bubbleEl.hidden = true;
    if (s.mode === 'walk') setMode('idle', 1e9);
    showTab(which);
    pet.focus();
    if (which === 'chat') setTimeout(() => inputEl.focus(), 30);
  }
  function closeChat() {
    chatOpen = false;
    popEl.hidden = true;
    if (s.mode === 'idle') s.timer = rand(1, 3);
  }
  function toggleChat() { chatOpen ? closeChat() : openChat(); }
  function showTab(which) {
    tab = which;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === which)));
    $('view-chat').hidden = which !== 'chat';
    $('view-jobs').hidden = which !== 'jobs';
    chatSig = null;
    if (which === 'jobs') renderJobs(true); else paintChat();
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('btn-close').addEventListener('click', closeChat);
  $('btn-app').addEventListener('click', () => { works.openApp(tab === 'jobs' ? 'factory' : 'assistant'); closeChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chatOpen) closeChat(); });

  function msgHTML(m) {
    if (m.role === 'user') return `<div class="msg me"><div class="b">${esc(m.text)}</div></div>`;
    const body = m.text ? md(m.text) : '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
    return `<div class="msg ${m.error ? 'err' : ''}"><div class="b">${body}${(m.actions || []).length ? `<div class="acts">${m.actions.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}</div></div>`;
  }
  let chatSig = null;
  function paintChat() {
    $('btn-stop').hidden = !state.chatBusy;
    $('btn-send').disabled = state.chatBusy;
    if (!chatOpen || tab !== 'chat') return;
    const msgs = state.chat.slice(-12);
    const sig = msgs.map((m) => m.id + (m.text || '').length + (m.actions || []).length).join('|');
    if (sig === chatSig) return;
    chatSig = sig;
    messagesEl.innerHTML = msgs.length ? msgs.map(msgHTML).join('') : `<div class="empty">Hi, I'm ${esc(foreman().name)}. Tell me what you need and I'll hand it to the right worker.</div>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || state.chatBusy) return;
    inputEl.value = '';
    works.askForeman(text);
  }
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('btn-stop').addEventListener('click', () => works.stopForeman());

  // ---------- jobs ----------
  let jobsSig = '';
  function renderJobs(force) {
    const active = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
    $('jobs-badge').hidden = active === 0;
    $('jobs-badge').textContent = String(active);
    if (!chatOpen || tab !== 'jobs') return;
    const list = state.jobs.slice(-25).reverse();
    const sig = list.map((j) => j.id + j.status + (j.pr ? j.pr.url : '') + (j.steps || []).length + (j.id === openJobId ? (j.output || '').length : '')).join('|') + openJobId;
    if (!force && sig === jobsSig) return;
    jobsSig = sig;
    const ul = $('job-list');
    const keepScroll = ul.scrollTop;
    ul.innerHTML = list.length ? list.map((j) => {
      const w = byWorker(j.workerId || j.pref);
      const [sl, sc] = STATUS[j.status] || STATUS.failed;
      const open = j.id === openJobId;
      const out = open ? `<div class="job-output b">${j.output ? md(j.output) : esc(j.status === 'queued' ? 'Waiting for a free worker.' : j.status === 'running' ? 'Thinking…' : j.errorDetail || j.error || 'No output.')}</div>` : '';
      const acts = j.status === 'queued' || j.status === 'running' ? `<div class="job-actions"><button class="btn small" data-stop="${j.id}">${j.status === 'queued' ? 'Cancel' : 'Stop'}</button></div>` : '';
      return `<li><div class="job-head" data-open="${j.id}"><span class="job-title">#${j.n} ${esc(j.text)}</span><span class="pill" style="--c:${sc}">${sl}</span></div><div class="job-meta">${w ? esc(w.name) : 'any worker'}${j.kind === 'code' ? ` · code${j.steps ? ` · ${j.steps.length} steps` : ''}${j.diff ? ` · +${j.diff.insertions} −${j.diff.deletions}` : ''}` : ''}${j.pr ? ` · <a href="${esc(j.pr.url)}" target="_blank" rel="noreferrer">PR #${j.pr.number}</a>` : ''}</div>${out}${acts}</li>`;
    }).join('') : '<li class="empty">No jobs yet. Ask me to get something done!</li>';
    ul.scrollTop = keepScroll;
  }
  $('job-list').addEventListener('click', (e) => {
    const stop = e.target.closest('[data-stop]');
    if (stop) { works.stopJob(stop.dataset.stop); return; }
    const head = e.target.closest('[data-open]');
    if (head) { openJobId = openJobId === head.dataset.open ? null : head.dataset.open; renderJobs(true); }
  });

  // ---------- engine sync ----------
  function applyPatch(p) {
    if (p.factory) {
      state.factory = p.factory;
      $('pet-name').textContent = foreman().name;
      $('pop-av').src = avatar();
    }
    if (p.jobs) for (const j of p.jobs) {
      const i = state.jobs.findIndex((x) => x.id === j.id);
      if (i >= 0) state.jobs[i] = j; else state.jobs.push(j);
    }
    if (p.removedJobs) state.jobs = state.jobs.filter((j) => !p.removedJobs.includes(j.id));
    if (p.chat) { state.chat = p.chat; state.chatBusy = !!p.chatBusy; paintChat(); }
    if (p.jobs || p.removedJobs) renderJobs();
  }
  function load(snap) {
    state = { ...state, ...snap };
    applyPatch({ factory: snap.factory, chat: snap.chat, chatBusy: snap.chatBusy });
    renderJobs(true);
  }
  works.onPatch(applyPatch);
  works.onReset(load);
  works.onNotice((n) => {
    if (n.kind === 'thinking') say(null, true);
    else if (n.kind === 'reply' || n.kind === 'job') say(n.text);
  });
  pet.onConfig((c) => {
    config = c;
    if (!config.roam && s.mode === 'walk') setMode('idle', 1e9);
    if (config.roam && s.mode === 'idle' && s.timer > 60) s.timer = rand(1, 3);
  });
  pet.onOpenChat(() => openChat('chat'));
  pet.onResetPosition(() => { s.x = innerWidth / 2 - SIZE / 2; s.y = -SIZE; s.vx = 0; s.vy = 0; setMode('fall'); });
  addEventListener('resize', () => { s.x = clamp(s.x, 0, innerWidth - SIZE); if (s.mode !== 'drag') s.y = Math.min(s.y, floorY()); });

  Promise.all([pet.getConfig(), works.getState()]).then(([c, snap]) => {
    config = c;
    load(snap);
    setMode('fall');
    requestAnimationFrame(tick);
  });
})();
