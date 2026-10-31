// BW-15: footer wiring + renderBuild behaviour (worker count text matches workers.length).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

assert(/ipcMain\.handle\('app:build'/.test(read('src/main.js')), 'main handles app:build');
assert(/buildInfo:\s*invoke\('app:build'\)/.test(read('src/preload.js')), 'preload exposes buildInfo');
assert(/id="buildInfo"/.test(read('src/renderer/app.html')), 'footer element present');

const js = read('src/renderer/app.js');
const m = js.match(/function renderBuild\(\) \{[\s\S]*?\n\}/);
assert(m, 'renderBuild found');
assert(/renderBuild\(\);\s*\n\s*\$\('lines'\)/.test(js), 'renderHeader calls renderBuild');

function run(label, n) {
  const el = { textContent: '' };
  const ctx = { buildLabel: label, workers: new Array(n).fill({}), $: () => el };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '; renderBuild();', ctx);
  return el.textContent;
}
assert.strictEqual(run('v0.1.0 (abc1234)', 6), 'v0.1.0 (abc1234) · 6 hired workers');
assert.strictEqual(run('v0.1.0', 1), 'v0.1.0 · 1 hired worker');
assert.strictEqual(run('', 0), '0 hired workers');
console.log('OK: build info footer (version label, worker count matches workers.length, singular/plural)');
