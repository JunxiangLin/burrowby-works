// Talks to Claude through the locally installed Claude Code CLI, run headless
// (`claude -p`). The CLI uses whatever login it already has (e.g. a claude.ai
// seat), so this app never sees or stores a credential.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_TIMEOUT_MS = 15 * 60 * 1000;

// Places the CLI usually lives on Windows besides PATH (Electron launched from
// a shortcut may not inherit the same PATH as a terminal).
function candidatePaths() {
  const home = os.homedir();
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude'];
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
  ];
  return dirs.filter(Boolean).flatMap((d) => names.map((n) => path.join(d, n)));
}

function findClaude(override) {
  if (override) return fs.existsSync(override) ? override : null;
  return candidatePaths().find((p) => fs.existsSync(p)) || null;
}

// { found, path, loggedIn, authMethod, email, version, error }
function status(override) {
  const exe = findClaude(override);
  if (!exe) return { found: false, error: 'Claude Code (claude.exe) was not found.' };
  const opts = { encoding: 'utf8', timeout: 20000, windowsHide: true };
  try {
    const version = execFileSync(exe, ['--version'], opts).trim();
    const auth = JSON.parse(execFileSync(exe, ['auth', 'status'], opts));
    return { found: true, path: exe, version, loggedIn: !!auth.loggedIn, authMethod: auth.authMethod, email: auth.email };
  } catch (err) {
    return { found: true, path: exe, loggedIn: false, error: `Could not read Claude Code login status: ${err.message.split('\n')[0]}` };
  }
}

class ClaudeError extends Error {}

// One headless turn. The prompt goes through stdin so long job instructions
// never hit the Windows command-line length limit.
function run({ exe, prompt, systemPrompt, model, effort, jsonSchema, sessionId, resume, cwd, signal }) {
  if (!exe) return Promise.reject(new ClaudeError('Claude Code is not installed or not found. See Settings.'));
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '', // plain chat model: no file, shell or web tools
    '--strict-mcp-config', // ignore the user's MCP servers
    '--setting-sources', '', // ignore the user's hooks and settings
    '--disable-slash-commands',
    '--system-prompt', systemPrompt,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));
  if (resume) args.push('--resume', resume);
  else if (sessionId) args.push('--session-id', sessionId);
  else args.push('--no-session-persistence');

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      child.kill();
      done(reject, Object.assign(new ClaudeError('Stopped.'), { aborted: true }));
    };
    const timer = setTimeout(() => {
      child.kill();
      done(reject, new ClaudeError('Claude Code took longer than 15 minutes and was stopped.'));
    }, RUN_TIMEOUT_MS);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => done(reject, new ClaudeError(`Could not start Claude Code: ${e.message}`)));
    child.on('close', (code) => {
      let result;
      try {
        result = JSON.parse(out.trim().split('\n').pop());
      } catch {
        const detail = (err || out).trim().split('\n').slice(-3).join(' ');
        return done(reject, new ClaudeError(`Claude Code exited (${code}) without a result. ${detail}`.trim()));
      }
      if (result.is_error || result.subtype !== 'success') {
        const msg = typeof result.result === 'string' && result.result ? result.result : result.subtype;
        const hint = /log ?in|auth|credential/i.test(msg) ? ' Run `claude` in a terminal and sign in.' : '';
        return done(reject, new ClaudeError(`Claude Code error: ${msg}.${hint}`));
      }
      done(resolve, {
        text: typeof result.result === 'string' ? result.result.trim() : '',
        structured: result.structured_output ?? null,
        sessionId: result.session_id,
      });
    });
    child.stdin.end(prompt);
  });
}

// Streaming worker run: `claude -p --output-format stream-json
// --include-partial-messages`. Calls onText(fullTextSoFar) on every text delta,
// so callers can record time to first token and show output live.
// A short, human label for one agent tool call, shown as a step in the job.
const WEB_TOOLS = ['WebSearch', 'WebFetch'];

function describeStep(name, input = {}, cwd) {
  const rel = (f) => {
    if (!f) return '';
    const s = String(f).replace(/\\/g, '/');
    const base = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/$/, '') + '/' : '';
    return base && s.toLowerCase().startsWith(base.toLowerCase()) ? s.slice(base.length) : s;
  };
  switch (name) {
    case 'Edit': case 'MultiEdit': return `Edited ${rel(input.file_path)}`;
    case 'Write': return `Wrote ${rel(input.file_path)}`;
    case 'Read': return `Read ${rel(input.file_path)}`;
    case 'Glob': return `Listed ${input.pattern || ''}`;
    case 'Grep': return `Searched for ${JSON.stringify(String(input.pattern || '').slice(0, 60))}`;
    case 'Bash': return `Ran ${String(input.command || '').split('\n')[0].slice(0, 120)}`;
    case 'WebSearch': return `Searched the web: ${JSON.stringify(String(input.query || '').slice(0, 120))}`;
    case 'WebFetch': return `Fetched ${String(input.url || '').slice(0, 200)}`;
    default: return `Used ${name}`;
  }
}

// opts.code (coding jobs): { tools, allowedTools, disallowedTools, maxTurns, env, timeoutMs, onStep }
// The tool flags for a run: none (plain text), web-only (research), or the coding allowlist.
function toolArgs({ code = null, web = null } = {}) {
  const args = [];
  if (code) {
    // Only the listed tools exist; dontAsk denies anything not pre-allowed, and
    // nobody is asked at runtime.
    args.push('--tools', code.tools.join(','), '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-turns', String(code.maxTurns || 40));
    if (code.allowedTools && code.allowedTools.length) args.push('--allowedTools', ...code.allowedTools);
    if (code.disallowedTools && code.disallowedTools.length) args.push('--disallowedTools', ...code.disallowedTools);
  } else if (web) {
    // Only the two web tools exist and both are pre-allowed; anything else is denied without asking.
    args.push('--tools', WEB_TOOLS.join(','), '--allowedTools', ...WEB_TOOLS, '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-turns', String(web.maxTurns || 12));
  } else {
    args.push('--tools', '');
  }
  return args;
}

// opts.web (research jobs): { maxTurns, timeoutMs, onStep, onTool } — only WebSearch and WebFetch, no file or shell tools.
function stream({ exe, prompt, systemPrompt, model, cwd, signal, onText = () => {}, onRateLimit = () => {}, code = null, web = null }) {
  if (!exe) return Promise.reject(new ClaudeError('Claude Code is not installed or not found. See Settings.'));
  const args = [
    '-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
    '--no-session-persistence', '--system-prompt', systemPrompt,
  ];
  args.push(...toolArgs({ code, web }));
  if (model) args.push('--model', model);
  const tooled = code || web;
  const onStep = (tooled && tooled.onStep) || (() => {});
  const onTool = (tooled && tooled.onTool) || (() => {});
  const limitMs = (tooled && tooled.timeoutMs) || RUN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: (code && code.env) || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    let text = '';
    let result = null;
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const fail = (msg, extra = {}) => Object.assign(new ClaudeError(msg), { text }, extra);
    const onAbort = () => {
      child.kill();
      done(reject, fail('Stopped.', { aborted: true, code: 'cancelled' }));
    };
    const timer = setTimeout(() => {
      child.kill();
      done(reject, fail(`Claude Code took longer than ${Math.round(limitMs / 60000)} minutes and was stopped.`, { code: 'timeout' }));
    }, limitMs);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    const handle = (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const b of ev.message.content) if (b.type === 'tool_use') { onTool(b.name, b.input || {}); onStep(describeStep(b.name, b.input, cwd)); }
      } else if (ev.type === 'stream_event') {
        const e = ev.event || {};
        if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text' && text && !text.endsWith('\n\n')) {
          text += '\n\n'; // separate narration from successive agent turns
        } else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
          text += e.delta.text;
          onText(text);
        }
      } else if (ev.type === 'rate_limit_event') {
        if (ev.rate_limit_info && ev.rate_limit_info.status && ev.rate_limit_info.status !== 'allowed') onRateLimit(ev.rate_limit_info);
      } else if (ev.type === 'result') {
        result = ev;
      }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => done(reject, fail(`Could not start Claude Code: ${e.message}`, { code: 'upstream_error' })));
    child.on('close', (code) => {
      if (buf.trim()) handle(buf.trim());
      if (!result) {
        const detail = err.trim().split('\n').slice(-3).join(' ');
        return done(reject, fail(`Claude Code exited (${code}) without a result. ${detail}`.trim(), { code: 'upstream_error' }));
      }
      for (const d of result.permission_denials || []) onStep(`Blocked: ${describeStep(d.tool_name, d.tool_input, cwd)}`);
      if (result.subtype === 'error_max_turns' && tooled) {
        // Out of turns is not fatal for a coding job: the app still commits what exists.
        return done(resolve, { text: text || 'Stopped at the turn limit.', stopReason: 'max_turns', inTok: 0, outTok: 0, model: null, maxTurns: true });
      }
      if (result.is_error || result.subtype !== 'success') {
        const msg = typeof result.result === 'string' && result.result ? result.result : result.subtype;
        const kind = /rate|limit|usage/i.test(msg) ? 'rate_limited' : /log ?in|auth|credential/i.test(msg) ? 'session_expired' : 'upstream_error';
        return done(reject, fail(`Claude Code error: ${msg}`, { code: kind }));
      }
      const finalText = typeof result.result === 'string' && result.result.trim() ? result.result : text;
      const u = result.usage || {};
      done(resolve, {
        text: finalText,
        stopReason: result.stop_reason,
        inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        outTok: u.output_tokens || 0,
        model: Object.keys(result.modelUsage || {})[0] || null,
      });
    });
    child.stdin.end(prompt);
  });
}

module.exports = { findClaude, status, run, stream, describeStep, toolArgs, ClaudeError, WEB_TOOLS };
