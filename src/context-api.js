// BWI-48: worker-facing Context library API (search, read, create).
// Transport-agnostic on purpose: every function takes plain JSON in and returns plain JSON out,
// so a later MCP server can expose them as tools without changes. `E` is an Engine.
const { redact } = require('./repos');
const MAX_RESULTS = 10;

function searchContext(E, { query = '', project = '', limit = 6 } = {}) {
  const q = String(query || '').toLowerCase();
  const p = project ? E.findProject(project) : null;
  if (project && !p) throw new Error(`No such project: ${project}`);
  const scoped = p ? new Set([...(p.ctx || []), ...E.tasks.filter((t) => t.projectId === p.id).flatMap((t) => t.ctx || [])]) : null;
  return E.contexts
    .filter((c) => (!scoped || scoped.has(c.id)) && (!q || `${c.title} ${(c.tags || []).join(' ')} ${c.content}`.toLowerCase().includes(q)))
    .slice(0, Math.max(1, Math.min(MAX_RESULTS, Number(limit) || 6)))
    .map((c) => ({ id: c.id, title: c.title, kind: c.kind, tags: c.tags || [], excerpt: (c.content || '').slice(0, 600) }));
}

function readContext(E, { id } = {}) {
  const c = E.ctxById(String(id || ''));
  if (!c) throw new Error(`No context entry ${id}`);
  return { id: c.id, title: c.title, kind: c.kind, tags: c.tags || [], content: c.content };
}

// Creates an entry and attaches it to a project (so every later job in it carries it) or to one task.
// Pass `task` (key like BWI-3) to attach to a task, else `project` (key); at least one is required.
function createContext(E, { title, content, kind = 'note', tags = [], project = '', task = '' } = {}) {
  const ttl = String(title || '').trim();
  if (!ttl) throw new Error('title is required');
  const body = String(content || '');
  if (!body.trim()) throw new Error('content is required');
  const t = task ? E.findTask(task) : null;
  if (task && !t) throw new Error(`No such task: ${task}`);
  const p = t ? E.projectById(t.projectId) : project ? E.findProject(project) : null;
  if (project && !p) throw new Error(`No such project: ${project}`);
  if (!t && !p) throw new Error('project or task is required to attach the entry');
  const entry = E.upsert('contexts', {
    id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: ttl,
    kind,
    tags: (Array.isArray(tags) ? tags : []).map((x) => String(x).slice(0, 40)).slice(0, 12),
    content: redact(body),
    createdAt: Date.now(),
  });
  if (t) { t.ctx = [...new Set([...(t.ctx || []), entry.id])]; E.upsert('tasks', t); }
  else { p.ctx = [...new Set([...(p.ctx || []), entry.id])]; E.upsert('projects', p); }
  return { id: entry.id, title: entry.title, attached_to: t ? E.taskKey(t) : p.key };
}

// Tool descriptors in a shape that maps 1:1 onto MCP tool definitions.
const CONTEXT_TOOLS = [
  { name: 'search_context', description: 'Search the context library; optionally only entries attached to one project.', input: { query: 'words to look for', project: 'optional project key' }, run: searchContext },
  { name: 'read_context', description: 'Read the full content of a context library entry by id.', input: { id: 'entry id from search_context' }, required: ['id'], run: readContext },
  { name: 'create_context', description: 'Create a context library entry attached to a project or a single task.', input: { title: 'short title', content: 'the entry text', kind: 'note | doc | data | style | snippet', tags: 'optional list of tags', project: 'project key', task: 'task key like BWI-3 (attaches to the task instead)' }, required: ['title', 'content'], run: createContext },
];

// Binds the tools to a running job: defaults the attachment to the job's task or project.
function toolsForJob(E, job) {
  const t = job && job.taskId ? E.taskById(job.taskId) : null;
  const p = job && job.projectId ? E.projectById(job.projectId) : null;
  return {
    search_context: (i = {}) => searchContext(E, { project: p ? p.key : '', ...i }),
    read_context: (i) => readContext(E, i),
    create_context: (i = {}) => createContext(E, { ...(i.project || i.task ? {} : t ? { task: E.taskKey(t) } : p ? { project: p.key } : {}), ...i }),
  };
}

// Text workers can't call tools mid-run, so they write fenced blocks in their reply:
//   ```context-entry
//   {"title": "...", "content": "...", "kind": "note", "scope": "project" | "task"}
//   ```
// This runs them after the job and returns the output with the blocks removed.
function applyContextBlocks(E, job, output) {
  const tools = toolsForJob(E, job);
  const made = [];
  const errors = [];
  const text = String(output || '').replace(/```context-entry\s*\n([\s\S]*?)```/g, (m, body) => {
    try {
      const o = JSON.parse(body);
      const t = job.taskId ? E.taskById(job.taskId) : null;
      const p = job.projectId ? E.projectById(job.projectId) : null;
      const target = o.scope === 'task' && t ? { task: E.taskKey(t) } : p ? { project: p.key } : t ? { task: E.taskKey(t) } : {};
      made.push(tools.create_context({ title: o.title, content: o.content, kind: o.kind, tags: o.tags, ...target }));
    } catch (e) { errors.push(e.message); }
    return '';
  });
  return { output: text.trim(), made, errors };
}

const WORKER_CONTEXT_INSTRUCTIONS = `
To save something to the shared Context library (for example a style guide, research notes or facts that later jobs in this project should reuse), include a fenced block in your reply:
\`\`\`context-entry
{"title": "short title", "content": "the entry text", "kind": "note", "scope": "project"}
\`\`\`
kind is one of note, doc, data, style, snippet. scope is "project" (default, later jobs in the project carry it) or "task". Only write an entry when the job asks for one or it is clearly worth reusing.
`;

module.exports = { searchContext, readContext, createContext, toolsForJob, applyContextBlocks, CONTEXT_TOOLS, WORKER_CONTEXT_INSTRUCTIONS };
