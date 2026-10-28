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
                  @n-dx/lang-kit                (language facts, pack contract)
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
  core/            # CLI orchestrator (published as @n-dx/core)
    cli.js         #   n-dx entry point (orchestration + delegation)
    ci.js          #   CI pipeline (analysis + PRD health validation)
    web.js         #   server orchestration (start/stop/status)
    config.js      #   unified config command (view/edit all package settings)
  sourcevision/    # analysis engine
  rex/             # PRD + task tracker
  hench/           # autonomous agent
  llm-client/      # vendor-neutral LLM foundation
  lang-kit/        # language facts + pack contract (foundation, no deps)
  web/             # dashboard + MCP HTTP server
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
| `start` + `work` | Yes | Different write targets — except a settings save to n-dx's own config (`.n-dx.json`, `.n-dx.local.json`, `.ndx/config*.json`, `.mcp.json`): the run's config backstop reverts it at its next restore point and fails the run; save again after the run |
| `start` + `plan` | Warning | Plan writes PRD roots; restart server to flush in-process caches |
| `ci` + `work` | No | Both write analysis and PRD roots |
| `plan` + `work` | No | Both write PRD roots |
| `refresh` + any writer | No | Refresh can rewrite analysis and PRD state |
| `config` + `config` | No | Both merge shared config files |
| `sv pack add\|remove` + another `sv pack add\|remove` | No | Both write the per-user pack directory, shared by every worktree and project on one ndx home; the second fails naming the holder's PID |

**General rule:** Commands that write to PRD roots, analysis output, or hench
config must not run concurrently. On v2 the PRD roots are `product/` and
`changes/` under the resolved rex directory (`.ndx/rex/` or legacy `.rex/`);
on v1 it is `prd_tree/`. A PRD lock is per workspace, so separate worktrees
can each write their own tree. A lock around a save alone cannot repair a
stale snapshot. See [PRD write concurrency](./prd-write-concurrency) and the
[public contract and merge requirements](./public-surface).
