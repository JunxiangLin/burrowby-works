# Burrowby Works desktop app ⛑️

Burrowby Works as one Windows desktop app. Your foreman (an orange-hatted cat by default) lives on the desktop: they walk along
the taskbar edge, sit and blink, and you can drag them anywhere and toss them. Click the pet to chat. The pet's menu opens the
full Burrowby Works window, which has four sections:

- **Assistant**: the same foreman conversation as the pet's chat popover.
- **Factory**: the animated factory floor, the job assign bar and the Control room (metrics, jobs, workers).
- **Board**: projects and kanban tasks you can send to the factory.
- **Context**: a library of notes, docs and style guides that get injected into job prompts.

Jobs started from the pet, the Assistant, the Factory bar or the Board all land in one shared job list with shared metrics.

## Quick start

Requirements:

- Node.js 18+ (tested with Node 22 on Windows 11).
- **Claude Code**, installed and signed in. Every Claude call goes through the `claude` CLI, so the app uses the account you signed
  Claude Code in with, for example a claude.ai Pro, Max, Team or Enterprise seat. **No API key is needed.** Install it from
  https://claude.com/claude-code, then open a terminal, run `claude` once and sign in. Running `claude auth status` should
  show `"loggedIn": true`.
- For coding workers: **git**, and the **GitHub CLI** signed in (`winget install GitHub.cli`, then `gh auth login`). The app
  uses `gh` to open, list and merge pull requests. Without it, coding still works and branches are pushed, but no PRs are opened.

```bash
npm install
```

```bash
npm start
```

The pet drops onto your taskbar. Right-click it (or the orange hard-hat tray icon) and choose **Open Burrowby Works**. If the app
can't find `claude.exe`, the Settings window opens and says what's missing. The app looks on your `PATH` and in
`%USERPROFILE%\.local\bin`, where the native installer puts it. If yours is somewhere else, paste the full path to `claude.exe` in Settings.

## Using it

### The desktop pet

| Do this | What happens |
| --- | --- |
| Left-click the pet | Opens or closes the chat popover. It shows the latest messages from the shared foreman chat, plus a Jobs tab with live output and Stop. |
| **Open app** in the popover | Opens the main window: the Assistant from the Chat tab, the Factory from the Jobs tab |
| Drag the pet | Picks it up. Let go and it falls back to the taskbar edge. Throw it for fun. |
| Right-click the pet or the tray icon | Menu: open chat, open Burrowby Works (or jump to a section), Settings, foreman species, roaming on or off, bring the pet back, Quit |
| Double-click the tray icon | Opens the main window |

Everything outside the pet, its bubble and its popover is click-through.

### The main window

This window is the Burrowby Works artifact itself: its markup, CSS, factory floor, pet drawings, charts, board and Markdown renderer are
ported from the artifact's source. The section switcher stays centered whichever section is open.

- **Factory.** Describe a job and pick a worker, a model tier and an optional project (whose context goes with the job). Then press Assign
  job. The Control room tabs are:
  - **Overview:** jobs shipped, success rate, run time p50/p95, time to first token p50/p95, queue and average wait, tokens, alerts,
    a stacked queued/thinking/writing chart, 5-minute throughput and worker utilization.
  - **Jobs:** a time breakdown for each job, with live streaming output, copy, stop, run again and delete.
  - **Workers:** edit a worker's name, species and specialty, hire or retire workers, and set 1, 2 or 3 jobs at once.
- **Board.** Projects have a name, key, color, description and project context. Tasks live in Backlog, To do, In progress, Testing, Review and
  Done columns, with drag and drop between them. The task drawer has title, description, status, priority, assignee, due date, labels, task context, run history and latest output.
  **Save and send to factory** moves the task to In progress, and to Review when the job ships (coding jobs pass through Testing first). **Suggest tasks** asks Claude
  for ideas. **Start with a sample project** sets up a demo.
- **Context.** Entries have a title, type, tags and up to 80,000 characters of content. You can import text files and attach entries to projects or
  tasks. A meter shows each entry's share of the 60,000-character per-job context budget. Attached entries go into the job prompt
  exactly as in the artifact.
- **Assistant.** Chat with the foreman, rename them, change their species, and set Thinking to quick or careful. The foreman can:
  - **Jobs:** check factory status; assign, read and stop jobs; stop all jobs.
  - **Board:** list and create projects; list, create and update tasks; send tasks to the factory; search the context library.
  - **Crew:** hire, update (name, species, specialty, capability) and retire workers; set jobs at once.
  - **Repos:** give a project a repo; list PRs; merge PRs into dev.
  - **Tickets:** accept a PM's proposed tickets.

  These run without an extra approval step. The foreman cannot release to prod.

## Coding workers and project repositories

Every worker has a **capability**, set in Control room → Workers or by asking the foreman:

| Capability | What a job does |
| --- | --- |
| **Text only** | Writes an answer, as in the artifact. |
| **Code** | For a task or job in a project that has a repository, edits the repo in its own git worktree, commits, and the app opens a PR into `dev`. Otherwise writes text. |
| **Project manager** | Writes notes and proposed tickets. The job detail lists them with checkboxes and an **Add selected to Backlog** button. The foreman can accept them too. |
| **QA** | Tests a coder's PR branch before the task reaches Review. See "The QA stage". |

Workers whose specialty starts with "Coder" are code-capable by default.

### Connecting a repository

Open the project (Board → Edit project), paste a GitHub URL or a local folder path under **Repository**, then click **Connect**. You can
also ask the foreman to do it. The app:

1. Clones it to `%USERPROFILE%\Burrowby\projects\<KEY>`. Your own working copy is never touched.
2. Makes sure the remote has `prod` (releases; only you move it) and `dev` (integration) branches. Missing ones are created from the default branch.

The Board header then shows which folder workers can edit, and a **Release to prod** button appears.

### What happens when a coder takes a task

1. The app creates a git worktree on a fresh branch, `feature/<KEY>-<n>-<slug>`, cut from `origin/dev`, under
   `%USERPROFILE%\Burrowby\worktrees\<KEY>\`.
2. It runs `claude -p` in that worktree with streaming output and only these tools: Read, Edit, Write, Glob, Grep, and Bash
   limited to an allowlist:
   - git status, diff, add, commit, log, show, restore, rm, mv
   - npm install, ci, test, run; node; npx
   - python, python3, pytest
   - docker build, docker compose

   Everything else is denied without asking (`--permission-mode dontAsk --permission-prompts none`). That includes `git push`,
   checkout, switch, branch, reset, merge, rebase and remote, plus `gh`, `curl` and `npm publish`. The run is capped at 40 turns and 25 minutes.
   The job's live output shows each step, for example "Edited src/engine.js" or "Ran npm test".
   Denied commands show as "Blocked: …".
3. The worker is told to commit with a message that starts with the task key. If it leaves changes uncommitted, the app commits them.
   If nothing changed, the job fails with `no_changes`.
4. **The app**, not the agent, pushes the branch and runs `gh pr create --base dev`. The worktree is then removed; the branch stays.
5. The task moves to **Testing** and QA starts automatically (see below). The task drawer and the job detail show:
   - the branch, with a PR link
   - the files changed, with + and − lines
   - every step the worker took

### The QA stage

The board runs Backlog → To do → In progress → **Testing** → Review → Done. Every coder's work on a task, whether it came from
**Save and send to factory** or a direct job tied to a task, goes through Testing before Review. There is no manual step:

1. When the coder's branch is pushed, the task moves to **Testing** and a job is queued for a **QA** worker (capability "QA").
   If the factory has none, one is hired automatically (Mochi if that name is free).
2. QA checks out the PR branch in its own worktree with the same tool allowlist and no push rights. It reads the diff, runs the
   existing tests, adds tests where they are missing, and checks the task's acceptance criteria. It ends with `VERDICT: PASS` or `VERDICT: FAIL`.
3. **Pass:** the task moves to **Review**. Tests QA added are pushed to the PR branch.
4. **Fail:** the task goes back to **In progress** with the original coder as assignee. Nothing from QA is pushed. Send the task to the
   factory again and the coder is given the QA notes.
5. QA notes are kept on the task (drawer → **QA notes**). If QA stops or gives no verdict, the task goes to Review with a note saying so,
   so it never sits in Testing.

Text and PM jobs have no PR, so they go straight to Review as before.

Merging: ask the foreman ("merge PR 3"), or merge on GitHub. The foreman's `merge_pr` refuses any PR that doesn't target `dev`.
Releasing: only the **Release to prod** button on the Board does it, after a confirmation. It fast-forwards `prod` to `dev` on the
remote, and refuses if `prod` has commits that `dev` doesn't.

### Safety rails

- Workers run only inside their own worktree. The app refuses any worktree that overlaps the folder the app was launched from,
  or that is outside `%USERPROFILE%\Burrowby`.
- Worker agents get an environment with nothing that looks like a token, secret, password or API key, and with git
  credentials disabled (`credential.helper` cleared, `GIT_TERMINAL_PROMPT=0`, `remote.origin.pushurl` set to an invalid URL).
  These settings stop the agent's own `git push` and stop casual pushes from scripts. They are not a sandbox: allowing `node`, `npm`,
  `python` and `docker` lets an agent run arbitrary code as you, and code determined to do so could undo them. The hard rules are
  the tool allowlist (no `git push`, `gh`, `curl` or branch switching), the worktree, and the app owning push, PR and merge. Only
  connect repositories whose contents you're comfortable letting a coding agent run code against.
- Prompts never include credentials. Remote URLs, tool steps, errors and output are scrubbed of embedded credentials and
  GitHub or Anthropic tokens before they're shown or saved.
- **Stop all jobs** sits in the Control room header, in the pet's right-click menu, and in the foreman's tools.

## Importing from the Burrowby Works artifact

1. In the artifact, open the Factory and click **Export data** in the Control room. It saves a `burrowby-works-*.json` file.
2. In this app, open **Settings → Import from Burrowby Works** and pick the file.
3. If this app already has data, it asks whether to **merge** or **replace**:
   - **Merge** keeps your local data and adds the imported items. An imported item with the same id replaces the local copy. Imported jobs whose
     number clashes with a local job are renumbered. The local foreman settings are kept. Chat histories are combined in time order.
   - **Replace** deletes the local data first.

Missing fields are filled with defaults and unknown fields are ignored. Imported jobs that were queued or running are marked
*stopped*, so an import never starts work by itself. The **Export data** button in this app writes the same format, so you can
also move data back the other way.

## How it works

- **Electron.** Electron gives a transparent, always-on-top, click-through window on Windows without a Rust toolchain. The cost is a
  download of about 100 MB.
- **One engine** (`src/engine.js`) runs in the main process. It holds the workers, jobs, projects, tasks, context and chat. It also runs the scheduler and the foreman.
  The pet overlay and the main window are views of it: they send changes over IPC and get patches back, so every window stays in sync,
  and jobs keep running when the main window is closed.
- **Worker jobs** use `claude -p --output-format stream-json --include-partial-messages --verbose`. Text deltas stream into
  the job as they arrive, so the app records the real time to first token and shows output live. The final `result` event provides real
  token counts. Each job is one call with the artifact's prompt: the worker's specialty plus attached context, then the job. At most
  1, 2 or 3 jobs run at once (the default is 2). Every call runs with `--tools ""` (no file, shell or web tools), `--strict-mcp-config`,
  `--setting-sources ""` and `--no-session-persistence`. Your own MCP servers, hooks and settings aren't loaded, and no session
  files pile up.
- **Model tiers** map to Settings: Quick = `claude-haiku-5-5`, Balanced = `claude-sonnet-5-5`, Deep-thinking = `claude-opus-5-5`.
  Usage counts against your Claude plan's limits, the same as using Claude Code yourself. If the CLI reports a usage limit, the
  Control room raises an alert.
- **The foreman** replies in a JSON action format that `claude --json-schema` enforces:
  `{"reply": "...", "actions": [{"tool": "assign_job", "input": {...}}]}`. These tools match the artifact's TOOLS object.
  The app runs the actions locally. When the foreman uses a lookup tool (`get_factory_status`, `get_job`, `list_projects`,
  `list_tasks`, `search_context`), the results go back to it in a follow-up call, up to 5 rounds per message. Each message
  includes the last 20 chat messages, the same as in the artifact.

### Where things are stored

| What | Where |
| --- | --- |
| Credentials | None stored by this app. Claude Code keeps its own sign-in. |
| Workers, jobs (the last 300), projects, tasks, context, chat | `%APPDATA%\burrowby-desk-pet\data\works.json` |
| Project clones | `%USERPROFILE%\Burrowby\projects\<KEY>` |
| Worker worktrees (removed after each push) | `%USERPROFILE%\Burrowby\worktrees\<KEY>\` |
| App settings (models, `claude.exe` path, roaming) | `%APPDATA%\burrowby-desk-pet\data\config.json` |

**Settings → Open data folder** opens that folder. Writes are atomic: the app writes a temp file, then renames it.

## Adding workers

Open the Factory, go to **Control room → Workers** and click **Hire a worker**. Then give the new worker a name, species, specialty and
capability, and click **Save worker**. You can also ask the foreman, for example "hire a second coder called Sprout". The specialty is the worker's instructions, and the foreman reads it to decide who gets which job. You can have up to 12
workers. To change how many jobs run at once, use the **Jobs at once** control at the top right of the Factory.

## Checks

```bash
npm run check
```

An offline test of the engine against a fake `claude` CLI, with no network.

- **Factory:** the jobs-at-once limit, streaming and time to first token, stop, Board → factory → Review, the context block and prompt
  format, the foreman's action loop, retiring workers, persistence, and import (merge and replace).
- **Coding (`scripts/check-code.js`):** uses real git against a temporary bare remote and a fake `gh`. It covers:
  - repo setup creating `prod` and `dev`
  - a coding job end to end: worktree from dev, worker commit, app push, `gh pr create --base dev`, task in Review, worktree removed
  - the app committing leftovers, and no-change jobs failing
  - merging only into dev, and release to prod
  - the safety rails: app folder, Burrowby root, scrubbed environment, redaction
  - PM tickets, the foreman's hire, update and list-PRs tools, and Stop all

```bash
npm run smoke
```

Starts the real app with a throwaway data folder. It covers:

- **Pet:** dragging and throwing it, falling back to the taskbar, click-to-chat, and click-through with the real cursor.
- **Main window:** opening it from the pet, showing exactly one section at a time with the switcher centered in each, and the sample
  project on the Board and in Context.

Don't touch the mouse while it runs. Screenshots go to `smoke-out/`. Set `SMOKE_LIVE=1` to also run one real Quick job and one foreman message through Claude Code.

## Updating from a newer artifact

`scripts/port-artifact.py` regenerates `src/renderer/app.html`, `app.css` and `app.js` from the artifact's source file. Every
replacement in it is asserted, so if the artifact changed in a way the port doesn't expect, the script stops and names the line
that no longer matches.

```bash
python scripts/port-artifact.py artifact/burrowby.html src/renderer
```

## Differences from the artifact

- **Data lives on this PC**, not in claude.ai storage. Use Export and Import to move data between the two.
- **The in-page roaming pet is gone.** The desktop pet replaces it. In the Assistant dock, **Drop me on the taskbar** brings the desktop pet back.
- **No simulation mode.** If Claude Code isn't ready, jobs wait in the queue and an alert says why.
- **Rate limits** come from your Claude plan's usage limits as reported by Claude Code. They aren't per-page limits.
- **The foreman has no streaming text.** Its replies arrive whole: about 3 to 15 seconds per message, longer when it looks things up.
- **Token counts** use real usage from Claude Code for finished jobs. While a job runs, the count is estimated as characters ÷ 4.

## Limitations

- Primary monitor only.
- Coding needs a project repository and a code-capable worker. Without them, jobs are text only, as in the artifact.
- No installer yet: run it from source with `npm start`.
- Each foreman message and each job starts a `claude` process, which adds about a second of startup.
