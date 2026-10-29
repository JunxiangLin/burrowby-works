// BWI-47 tests: `node scripts/test-board.js`. Board queries, CLI and prompt wiring.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSnapshot, listTickets, getTicket } = require('../src/board.js');
const cli = require('../src/board-cli.js');
const { Engine } = require('../src/engine.js');

const project = { id: 'p1', key: 'BWI', name: 'Board' };
const tasks = [
  { projectId: 'p1', n: 1, title: 'Login page', desc: 'Build the login form', status: 'todo', priority: 'high', assignee: 'w1' },
  { projectId: 'p1', n: 2, title: 'Fix crash', desc: 'Null pointer on startup', status: 'done', priority: 'urgent', assignee: 'w2' },
  { projectId: 'p1', n: 3, title: 'Docs', desc: 'Write login docs', status: 'todo', priority: 'low', assignee: '' },
  { projectId: 'other', n: 1, title: 'Elsewhere', desc: '', status: 'todo', priority: 'low', assignee: '' },
];
const names = { w1: 'Pebble', w2: 'Moss' };
const snap = buildSnapshot({ project, tasks, workerName: (id) => names[id] || '' });
const keys = (a) => a.map((t) => t.key);

let fails = 0;
const test = (name, fn) => { try { fn(); console.log('PASS: ' + name); } catch (e) { fails++; console.log('FAIL: ' + name + ' - ' + e.message); } };

test('lists all tickets of the project only', () => {
  assert.deepStrictEqual(keys(listTickets(snap)), ['BWI-1', 'BWI-2', 'BWI-3']);
  assert.deepStrictEqual(Object.keys(snap.tickets[0]).sort(), ['assignee', 'description', 'key', 'priority', 'status', 'title']);
});
test('filters by assignee, status, priority', () => {
  assert.deepStrictEqual(keys(listTickets(snap, { assignee: 'pebble' })), ['BWI-1']);
  assert.deepStrictEqual(keys(listTickets(snap, { status: 'todo' })), ['BWI-1', 'BWI-3']);
  assert.deepStrictEqual(keys(listTickets(snap, { priority: 'urgent' })), ['BWI-2']);
});
test('keyword search matches title/description and combines with filters', () => {
  assert.deepStrictEqual(keys(listTickets(snap, { keyword: 'LOGIN' })), ['BWI-1', 'BWI-3']);
  assert.deepStrictEqual(keys(listTickets(snap, { keyword: 'login docs' })), ['BWI-3']);
  assert.deepStrictEqual(keys(listTickets(snap, { keyword: 'login', assignee: 'Pebble' })), ['BWI-1']);
  assert.deepStrictEqual(listTickets(snap, { keyword: 'nothing here' }), []);
});
test('getTicket by key; unknown is null; results are copies', () => {
  assert.strictEqual(getTicket(snap, 'bwi-2').title, 'Fix crash');
  assert.strictEqual(getTicket(snap, 'BWI-9'), null);
  getTicket(snap, 'BWI-2').title = 'changed';
  assert.strictEqual(getTicket(snap, 'BWI-2').title, 'Fix crash');
});
test('CLI is read-only transport over the snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi47-'));
  const file = path.join(dir, 's.json');
  fs.writeFileSync(file, JSON.stringify(snap));
  const before = fs.readFileSync(file, 'utf8');
  assert.deepStrictEqual(keys(cli.run([file, 'list', '--status', 'todo', '--keyword', 'docs'])), ['BWI-3']);
  assert.strictEqual(cli.run([file, 'get', 'BWI-1']).assignee, 'Pebble');
  assert.throws(() => cli.run([file, 'get', 'BWI-99']));
  assert.throws(() => cli.run([file, 'delete']));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});
test('engine adds board instructions and a snapshot to the code prompt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwi47e-'));
  const E = new Engine({ dir, claude: { exe: () => 'x', modelFor: () => 'm', cwd: dir, stream: () => new Promise(() => {}) } });
  E.saveNow = () => {}; E.save = () => {};
  const p = E.upsert('projects', { id: 'p1', name: 'P', key: 'P', seq: 0, createdAt: 1 });
  E.makeTask(p, { title: 'Alpha ticket', status: 'todo' });
  const out = E.buildCodePrompt({ text: 'do it', projectId: 'p1', ctx: [] }, { name: 'W' }, 'P-1', { branch: 'b' });
  assert.ok(out.includes('Board access (read-only)') && out.includes('board-cli.js'));
  const file = path.join(dir, 'board', 'P.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).tickets[0].title, 'Alpha ticket');
  assert.ok(!E.buildCodePrompt({ text: 'x', ctx: [] }, { name: 'W' }, 'P-1', { branch: 'b' }).includes('Board access'));
});

process.exit(fails ? 1 : 0);
