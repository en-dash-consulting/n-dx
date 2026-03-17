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

See [Web Zone Architecture](/architecture/web-zone-architecture) for governance details.

## MCP Endpoints

The server exposes MCP over Streamable HTTP:

- `http://localhost:3117/mcp/rex` — Rex MCP tools
- `http://localhost:3117/mcp/sourcevision` — SourceVision MCP tools

See [MCP Integration](/guide/mcp) for setup instructions.

## Static Export

```sh
ndx export .                        # export to .sourcevision/site/
ndx export --out-dir=./build .      # custom output directory
ndx export --deploy=github .        # deploy to GitHub Pages
```

Generates a static, self-contained dashboard that can be hosted anywhere.
