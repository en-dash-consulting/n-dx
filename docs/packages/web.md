# Web Dashboard

`@n-dx/web` provides a browser-based project dashboard and unified MCP HTTP server.

## Features

- **SourceVision zone maps** — interactive visualization of architectural zones
- **PRD status** — tree view of epics, features, tasks with completion stats
- **Unified MCP server** — single HTTP endpoint serving both Rex and SourceVision MCP tools
- **Live reload** — updates automatically when data changes (via `ndx refresh`)

## Usage

```sh
ndx start .                 # foreground on port 3117
ndx start --port=8080 .     # custom port
ndx start --background .    # daemon mode
ndx start status .          # check if running
ndx start stop .            # stop daemon
ndx dev .                   # dev mode with live reload
```

## Architecture

The web package has four internal zones forming a hub topology:

```
  web-server          (Express routes, gateways, MCP handlers)
       ↓                    ↓ (serves static assets only)
  web-viewer          (Preact UI hub — components, hooks, views)
       ↑ ↓                  ↓
  viewer-message-pipeline  (messaging middleware)
       ↓                    ↓
  web-shared          (framework-agnostic utilities)
```

- **web-server** — composition root; wires gateways and routes but doesn't import web-viewer at runtime (viewer is built separately and served as static assets)
- **web-viewer** — the hub; imports from messaging pipeline and web-shared
- **viewer-message-pipeline** — coalescer, throttle, rate-limiter, request-dedup
- **web-shared** — data-file constants, view identifiers; zero framework dependencies

See [Web Zone Governance](/contributing/web-zone-governance) for internal governance details.

## MCP Endpoints

The server exposes MCP over Streamable HTTP:

- `http://localhost:3117/mcp/rex` — Rex MCP tools
- `http://localhost:3117/mcp/sourcevision` — SourceVision MCP tools

See [MCP Integration](/guide/mcp) for setup instructions.

## PRD item routes

`PATCH /api/rex/items/:id` accepts only these fields: `status`, `failureReason`, `priority`, `tags`, `title`, `description`, `acceptanceCriteria` and `requirements`. Any other key (including `run`) is a `400` naming it. The update runs inside the PRD lock for the request's workspace and answers `409` when another process holds it. Saved run settings are written through `PUT /api/hench/prep/:taskId` (below), MCP `edit_item`, or `rex update --run` — not this route.

## Prepare task

The Prepare task modal shows every per-task `ndx work` option before a run
starts: hench's resolved value for each, the key that supplied it, the
refusals a run would hit, the equivalent terminal command and a brief preview.

A change can be for this run or for the task, and the two are separate buttons:

- **Execute** runs the task now with the edits, and nothing is written to the
  PRD.
- **Save** writes the settings onto the PRD item, where `ndx work` reads them
  from a terminal too. "Run it differently once" and "this is how this task
  should be run" are different intentions; a single button would make every
  experiment permanent.

**What Save writes.** The fields that differ from the project default. A field
equal to the default is omitted rather than frozen, so a later change to
`llm.*` or `hench.*` still reaches the task. Launch-time options (`fresh`,
`allowDirty`) are never saved — they describe how one run starts. An exact
model is written per vendor (`models: {"claude": "…"}`), because a saved block
is vendor-agnostic and may later be run under another vendor; a pin for a
vendor this project is not on today is carried through untouched.

**Sources.** A field the task supplies reads "saved on task", with the project
default beside it ("project default: claude-sonnet from llm.claude.model"), so
the reader can see what the saved value displaced.

**Reset to defaults** clears the edits first. With nothing but saved settings
left it asks before clearing the block ("Clear 2 saved settings for this
task?"), because another session may be relying on it.

**Conflicts.** Each save carries the version the modal loaded. A save made
against a read someone else has overtaken is refused, and the modal shows
"These settings were saved elsewhere since you opened this." with **Reload**
(take the server's values, drop the edits) and **Overwrite** (resend against
the version the refusal named).

**Off the anchor** the footer says "Saved on branch `<name>`; lands when the
branch merges" — saving from a branch worktree is allowed, and writes that
worktree's PRD.

**Footer** counts the two facts separately: how many changes apply to this run
only, and how many settings are saved and apply from the terminal too. The
**Ready to run** list marks a task carrying saved settings with a labelled dot,
so it is visible before the modal is opened.

### `PUT /api/hench/prep/:taskId`

Saves or clears a task's run settings.

```jsonc
// request
{ "run": { "tier": "heavy", "review": true }, "version": "a1b2c3d4e5f6" }
// 200
{ "saved": { "tier": "heavy", "review": true }, "version": "9f8e7d6c5b4a",
  "workspace": { "key": null, "branch": "main", "isAnchor": true } }
```

- `run` is the whole block; `null` or `{}` clears it. Keys, types and bounds
  are checked by rex's own `validateRunSettings`, so what the dashboard accepts
  cannot drift from what the store and `ndx work` accept. A launch-time key is
  a `400` naming it, as is an unknown key or an out-of-range value. A model or
  provider the active vendor cannot serve is refused before it is saved.
- `version` is a fingerprint of the block as the client last read it —
  `"none"` for a task carrying nothing — reported by `GET /api/hench/prep/:taskId`
  as `savedVersion`. It is re-read and compared **inside** the write
  transaction, so nothing can land between the read it compares against and the
  write it guards. A stale version answers `409` with `{conflict: true, saved,
  version}`; resending with that version is the overwrite. It is a fingerprint
  of the settings rather than the item's `lastModified`, so renaming a task
  does not invalidate a version the renamer never touched.
- The write runs inside `store.withTransaction` for **the request's
  workspace** (`/w/<key>/` or `X-Ndx-Workspace`), taking that worktree's PRD
  lock and rewriting that worktree's tree alone. A lock it cannot acquire is a
  `409` naming the holder's PID.
- A missing task is `404`, a container (epic or feature) is a `400` — only
  tasks and subtasks carry run settings — and a workspace with no PRD is `404`.
  A foreign-site request is refused before anything is written.

`GET /api/hench/ready` rows carry `saved: boolean` for the same state.

## Static Export

```sh
ndx export .                        # export to ./ndx-export/ (gitignored)
ndx export --out-dir=./build .      # custom output directory
ndx export --deploy=github .        # deploy to GitHub Pages — confirms first
ndx export --deploy=github --yes .  # unattended deploy (CI)
```

Generates a static, self-contained dashboard that can be hosted anywhere.

**What is published.** PRD items (titles, descriptions, acceptance criteria, status), SourceVision analysis data (inventory, import graph, zones), and hench run *summaries* (status, token usage, files changed).

**What is not published.** Agent transcripts — hench `toolCalls` inputs and outputs, `events`, and `error` bodies — are stripped from every exported run by default, because they contain whatever the agent read or printed (`.env` contents, `process.env`, fixture data). Pass `--include-transcripts` to publish them deliberately; the static Task Audit view then shows them, otherwise it says the transcript was not included.

`--deploy=github` force-pushes to `origin/n-dx-dashboard`. It prints a manifest (remote, branch, run count, PRD item count, transcript inclusion) and asks for confirmation; when stdin is not a TTY it stops before writing or pushing unless `--yes` is passed. The dashboard's Export panel sends `--yes` only from its own confirmation step.
