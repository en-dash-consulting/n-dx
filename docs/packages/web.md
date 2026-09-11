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
