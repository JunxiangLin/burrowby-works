// Pet drawing and the Markdown renderer, copied verbatim from the Burrowby
// Works artifact so the desktop pet looks exactly like the foreman there.
// Used by the desktop-pet overlay (pet.html).
(() => {
const SPECIES = {
  bunny:   { body: '#F7EAF1', line: '#C7A2B5', belly: '#FFFFFF' },
  cat:     { body: '#FFCF94', line: '#D39A55', belly: '#FFF0DC' },
  bear:    { body: '#C99C77', line: '#93694A', belly: '#EBCFB4' },
  frog:    { body: '#9BDA86', line: '#64A955', belly: '#DDF5CF' },
  chick:   { body: '#FFE873', line: '#DDB52D', belly: '#FFF6C2' },
  axolotl: { body: '#FFC2D5', line: '#DF87A6', belly: '#FFE6EE' },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
window.Burrowby = { SPECIES, esc, ell, roundRect, drawPet, md };
})();
