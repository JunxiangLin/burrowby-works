// Read-only board queries (BWI-47). Pure functions over a plain snapshot, with no
// file, process or network access, so a CLI today and an MCP server later can both
// wrap them. Snapshot shape: { project: {key, name}, tickets: [Ticket] } where
// Ticket = { key, title, description, status, priority, assignee }.

// Builds a snapshot from engine data. Copies only the fields workers may read.
function buildSnapshot({ project, tasks, workerName }) {
  const tickets = (tasks || [])
    .filter((t) => t.projectId === project.id)
    .sort((a, b) => a.n - b.n)
    .map((t) => ({
      key: `${project.key}-${t.n}`,
      title: t.title || '',
      description: t.desc || '',
      status: t.status || '',
      priority: t.priority || '',
      assignee: (workerName && workerName(t.assignee)) || '',
    }));
  return { project: { key: project.key, name: project.name }, tickets };
}

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// filter: { assignee, status, priority, keyword } (all optional, combined with AND).
// keyword matches key, title and description, case-insensitive; every word must match.
function listTickets(snapshot, filter = {}) {
  const words = String(filter.keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
  return ((snapshot && snapshot.tickets) || [])
    .filter((t) => !filter.assignee || eq(t.assignee, filter.assignee))
    .filter((t) => !filter.status || eq(t.status, filter.status))
    .filter((t) => !filter.priority || eq(t.priority, filter.priority))
    .filter((t) => {
      if (!words.length) return true;
      const hay = `${t.key} ${t.title} ${t.description}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((t) => ({ ...t }));
}

function getTicket(snapshot, key) {
  const t = ((snapshot && snapshot.tickets) || []).find((x) => eq(x.key, key));
  return t ? { ...t } : null;
}

module.exports = { buildSnapshot, listTickets, getTicket };
