// Read-only command line for workers (BWI-47). A thin transport over src/board.js.
//   node board-cli.js <snapshot.json> list [--assignee X] [--status X] [--priority X] [--keyword "words"]
//   node board-cli.js <snapshot.json> get <KEY-1>
// Prints JSON. It only ever reads the snapshot file.
const fs = require('fs');
const { listTickets, getTicket } = require('./board');

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(assignee|status|priority|keyword)$/.exec(argv[i]);
    if (m && i + 1 < argv.length) f[m[1]] = argv[++i];
  }
  return f;
}

function run(argv) {
  const [file, cmd, ...rest] = argv;
  if (!file || !['list', 'get'].includes(cmd)) throw new Error('usage: board-cli.js <snapshot.json> list [--assignee X] [--status X] [--priority X] [--keyword W] | get <KEY>');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cmd === 'list') return listTickets(snap, parseArgs(rest));
  const t = getTicket(snap, rest[0]);
  if (!t) throw new Error(`no ticket ${rest[0] || ''}`);
  return t;
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { run, parseArgs };
