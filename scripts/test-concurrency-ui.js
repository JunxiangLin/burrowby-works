// BW-14: static checks on the jobs-at-once control in the renderer.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fail = 1; };

const seg = html.slice(html.indexOf('id="concSeg"'), html.indexOf('id="concNum"'));
const vals = [...seg.matchAll(/data-c="(\d+)"/g)].map((m) => +m[1]);
ok(JSON.stringify(vals) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'static buttons offer every value 1..12 (got ' + vals.join(',') + ')');
ok(/id="concNum"[^>]*max="12"/.test(html), 'number input max is 12');
ok(js.includes("can't be more than the number of hired workers"), 'crew-size limit message present');
ok(/Array\.from\(\{ length: maxConc\(\) \}/.test(js), 'runtime buttons built for every value up to maxConc');
process.exit(fail);
