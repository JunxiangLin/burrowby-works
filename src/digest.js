// Owner digest: what shipped, what is stuck, and what needs the owner.
// Pure function over engine data so it is easy to test.
const DAY = 24 * 3600 * 1000;
const STUCK_MS = 24 * 3600 * 1000; // active job / in-progress task older than this counts as stuck
const MAX_LINES = 3; // per section, so the digest fits one speech panel

function buildDigest({ jobs = [], tasks = [], taskKey = (t) => t.title, now = Date.now(), since = now - DAY, stuckMs = STUCK_MS } = {}) {
  const line = (j) => `#${j.n} ${String(j.text || '').replace(/\s+/g, ' ').slice(0, 50)}`;
  const shipped = jobs.filter((j) => j.status === 'done' && (j.finishedAt || 0) >= since).map(line);
  const stuck = [
    ...jobs.filter((j) => j.status === 'failed' && (j.finishedAt || 0) >= since).map((j) => `${line(j)} (failed)`),
    ...jobs.filter((j) => (j.status === 'queued' || j.status === 'running') && now - (j.startedAt || j.createdAt || now) > stuckMs).map((j) => `${line(j)} (${j.status} too long)`),
    ...jobs.filter((j) => j.merge && j.merge.status === 'blocked' && (j.merge.at || 0) >= since).map((j) => `${line(j)} (merge blocked)`),
  ];
  const needs = tasks.filter((t) => t.status === 'review').map((t) => `${taskKey(t)} ${String(t.title || '').slice(0, 50)}`);
  const cut = (items) => ({ items: items.slice(0, MAX_LINES), more: Math.max(0, items.length - MAX_LINES) });
  const sections = [
    { id: 'shipped', title: 'Shipped', ...cut(shipped), total: shipped.length },
    { id: 'stuck', title: 'Stuck', ...cut(stuck), total: stuck.length },
    { id: 'needs', title: 'Needs you', ...cut(needs), total: needs.length },
  ].filter((s) => s.total > 0); // empty sections are hidden
  return { at: now, empty: sections.length === 0, sections };
}

module.exports = { buildDigest, STUCK_MS };
