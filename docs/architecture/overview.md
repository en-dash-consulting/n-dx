# Architecture Overview

n-dx is organized as a pnpm monorepo with a strict four-tier dependency hierarchy.

## Dependency Tiers

```
  Orchestration   cli.js, web.js, ci.js        (spawns CLIs, no library imports)
                  config.js                     (spawn-exempt — see below)
       ↓
  Execution       hench                         (agent loops, tool dispatch)
       ↓
  Domain          rex · sourcevision            (independent, never import each other)
       ↓
  Foundation      @n-dx/llm-client              (shared types, API client)
```

**Rules:**
- Each layer imports only from the layer below
- Domain packages never import each other
- Orchestration scripts spawn CLIs via `execFile` — they never `import` from packages
- Zero circular dependencies

The web package sits alongside orchestration — it imports domain packages through [gateway modules](./gateways) to serve the dashboard and MCP endpoints.

### Spawn-exempt exception

`config.js` directly reads/writes package config files (`.rex/config.json`, `.hench/config.json`, `.sourcevision/manifest.json`, `.n-dx.json`) rather than spawning CLIs. Config operations require cross-package reads, atomic merges, and validation logic that can't be expressed as a single CLI spawn.

## Monorepo Structure

```
packages/
  sourcevision/    # analysis engine
  rex/             # PRD + task tracker
  hench/           # autonomous agent
  llm-client/      # vendor-neutral LLM foundation
  web/             # dashboard + MCP HTTP server
cli.js             # n-dx entry point (orchestration + delegation)
ci.js              # CI pipeline (analysis + PRD health validation)
web.js             # server orchestration (start/stop/status)
config.js          # unified config command (view/edit all package settings)
```

## Cross-Tier Communication

### Spawn vs. Gateway

| Signal | Use spawn | Use gateway |
|--------|-----------|-------------|
| Caller tier | Orchestration (cli.js, ci.js, web.js) | Execution or Domain |
| Data flow | Fire-and-forget or exit-code only | Structured return values |
| Frequency | Per-command (once per CLI invocation) | Per-request (hot path) |
| Error handling | Exit code + stderr | Typed errors, retries, partial results |
| State sharing | None (stateless) | Shared in-memory state |

See [Gateway Modules](./gateways) for the full gateway pattern.

## Shared State via Filesystem

Packages share state through filesystem rather than runtime imports:

| Directory | Owner | Readers |
|-----------|-------|---------|
| `.sourcevision/` | sourcevision | rex, web |
| `.rex/` | rex | hench, web |
| `.hench/` | hench | web |

Single writer per file. Hench and web read `.rex/` files but modify PRD state by invoking rex APIs. See [PACKAGE_GUIDELINES.md](https://github.com/en-dash-consulting/n-dx/blob/main/PACKAGE_GUIDELINES.md) for the full write-access protocol.

## Concurrency

| Command pair | Safe? | Notes |
|-------------|-------|-------|
| `start` + `status` | Yes | Status is read-only |
| `start` + `work` | Yes | Different write targets |
| `start` + `plan` | Warning | Plan writes `.rex/prd.json`; restart server after |
| `ci` + `work` | No | Both write `.sourcevision/` and `.rex/prd.json` |
| `plan` + `work` | No | Both write `.rex/prd.json` |

**General rule:** Commands that write to `.rex/prd.json`, `.sourcevision/`, or `.hench/config.json` must not run concurrently.
