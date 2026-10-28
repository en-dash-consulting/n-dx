# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

## Packages

- **sourcevision** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption.
- **rex** — PRD management: the v2 product layer holds areas, capabilities and constraints; the change layer holds changes, tasks and subtasks. Capability criteria describe standing requirements; acceptance criteria describe when work is done. `analyze` proposes changes, `status` shows progress. Intent is Markdown; tool state is committed `state.yaml`.
- **hench** — Autonomous agent: picks next rex task, builds a brief, drives an LLM in a tool-use loop, records runs in `.hench/runs/`.
- **lang-kit and packs** — `@n-dx/lang-kit`: language facts and the pack contract (foundation, no dependencies). `@n-dx/lang-runtime` and the `@n-dx/lang-*` packs: sourcevision loads them at run time. See each package's `AGENTS.md`.
- **graview** — Graview projection: `ndx graview emit|check|describe|serve|mcp` writes a `graview-document` declaration and a `{nodes, edges}` snapshot of the PRD, the analysis and the runs under the layout's graview dir, then spawns the `graview` CLI on them. No `@graview/*` dependency; the binary is a peer tool.
- **graview-face** — The product face on Graview: a Vite + React app, published on its own, that lays n-dx's shell, home and record pages over the emitted document. `ndx graview serve` runs it as the `graview-face` extension.

### Architecture

Four-tier dependency hierarchy (each layer imports only from the layer below):

```
  Orchestration   packages/core/               (spawns CLIs, no library imports)
                  config.js                     (spawn-exempt — see note below)
       ↓
  Execution       hench                         (agent loops, tool dispatch)
       ↓
  Domain          rex · sourcevision            (independent, never import each other)
  Packs           @n-dx/lang-runtime, lang-*    (beside Domain: loaded, never imported)
       ↓
  Foundation      @n-dx/llm-client              (shared types, API client)
                  @n-dx/lang-kit                (language facts, pack contract)
```

Zero circular dependencies. The web package sits alongside orchestration — it imports all domain packages to serve the unified dashboard.

The web package's internal layering (`web-server` → `web-viewer` →
`viewer-message-pipeline` → `src/shared/`) is package-level policy and lives in
`packages/web/AGENTS.md`.

##### Monorepo-wide zone fragility governance

A production zone with **cohesion < 0.5 AND coupling > 0.5** is a dual-fragility
zone and needs active governance. Zone ids and metrics are Louvain output and
move between analyses, so read the live values with `ndx analyze --deep .` then
`ndx zone <id>` (or the `/ndx-zone` skill) rather than trusting a list. Three
rules hold whatever the current zones are:

- **Two-consumer rule.** A new module in a shared directory needs at least two
  distinct consumer zones; a single-consumer utility belongs next to its use site.
- **Cohesion monitoring.** A change that drops a zone's cohesion below its
  current value needs explicit justification.
- **Directory policies outlive zone detection.** A rule tied to a directory
  stays in force whether or not Louvain still emits a zone for it — tests
  enforce it, not the analyser. Correct a stale metric; do not delete a policy
  because its zone stopped appearing.

Per-package zone policy lives in `packages/<pkg>/AGENTS.md`; the threshold and
the web package's internal layering are covered fully in
[docs/architecture/overview.md](docs/architecture/overview.md).

> **Spawn-exempt exception:** `config.js` directly reads/writes package config files (`.rex/config.json`, `.hench/config.json`, `.sourcevision/manifest.json`, `.n-dx.json`) rather than delegating to spawned CLIs. This is intentional — config operations require cross-package reads, atomic merges, and validation logic that cannot be expressed as a single CLI spawn. It is the only orchestration-tier script that breaks the spawn-only rule.

### Gateway modules

Cross-package runtime imports concentrate into one gateway module per upstream
package, so the dependency surface stays explicit and auditable.

| Package | Gateway file | Imports from |
|---------|-------------|--------------|
| hench | `src/prd/rex-gateway.ts` | rex |
| hench | `src/prd/llm-gateway.ts` | @n-dx/llm-client |
| web | `src/server/rex-gateway.ts` | rex |
| web | `src/server/domain-gateway.ts` | sourcevision |
| web | `src/viewer/external.ts` | `src/viewer/messaging/`, `src/shared/`, `src/schema/` |
| web | `src/viewer/api.ts` | `src/viewer/types.ts`, `src/viewer/route-state.ts` |

Export inventories and the ceiling `tests/e2e/architecture-policy.test.js`
holds them to are in
[docs/architecture/gateways.md](docs/architecture/gateways.md) — read it before
adding to a gateway.

Rules:
- **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways (e.g. web has separate gateways for rex and sourcevision).
- **Re-export only** — gateways re-export; they contain no logic. Enforced by `domain-isolation.test.js`.
- **Type imports through gateway** — `import type` flows through the gateway
  too, or a type import gets silently promoted to a runtime one in a later
  refactor. Per-package exemptions are documented in that package's `AGENTS.md`.
- **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

Per-package gateways, exemptions and seam registries are in that package's
`AGENTS.md`; the pattern reference is `PACKAGE_GUIDELINES.md`.

**Package-level guidance lives in `packages/<pkg>/AGENTS.md`.** Zone policies, seam registries and any other note that governs one package belong there, because every assistant reads a package's `AGENTS.md`. The `CLAUDE.md` beside it is a one-line `@AGENTS.md` import and holds nothing of its own; `tests/e2e/instruction-alignment.test.js` fails a package that breaks either half of that pair.

### Tier boundary crossing: spawn vs gateway

When a new feature requires crossing a tier boundary, use this decision rule:

The signal table — caller tier, data flow, frequency, error handling, state
sharing — is in [docs/architecture/overview.md](docs/architecture/overview.md).

**Rules of thumb:**
- Orchestration-tier scripts **always spawn** — they must not `import` from packages (exception: `config.js` for cross-package config reads).
- If the consumer is a library (hench, web), use a **gateway module** to keep the import surface explicit and auditable.
- If in doubt, prefer spawn — it provides stronger isolation and can always be replaced with a gateway later if performance requires it.

### Concurrency contract

The four orchestration entry points (`cli.js`, `web.js`, `ci.js`, `config.js`)
share mutable state on disk. `ndx status` and `ndx usage` are read-only and
safe against anything. `ndx start` runs alongside `ndx work`, and tolerates
`ndx plan` — though only a restart flushes its in-process caches. Never pair
two writers: `ndx ci` with `ndx work`, `ndx plan` with `ndx work`, `ndx refresh`
with any write command, or two `ndx config` runs. The full table is in
[docs/architecture/overview.md](docs/architecture/overview.md#concurrency).

**General rule:** Commands that write to the PRD backend (`product/` and `changes/` under the resolved rex directory on v2, `prd_tree/` on v1), sourcevision output, or hench config must not run concurrently. Read-only commands (`status`, `usage`) are always safe.

**Lock scope.** V2 writes use `withPrdModelTransaction`; store consumers use
`store.withTransaction`. The PRD lock covers read-modify-write and a refused
writer names its holder. It is per workspace (`rexDir`), so it does not
serialize two worktrees. A lock around a save alone cannot refresh an older
snapshot; keep writers sequential. Reasoning and the export carve-outs:
[docs/architecture/prd-write-concurrency.md](docs/architecture/prd-write-concurrency.md).

**PRD invariant.** On v2 the only writable PRD roots are `product/` and `changes/` under the resolved rex directory (`.ndx/rex/`, or `.rex/` on the legacy directory layout): Markdown intent plus committed `state.yaml`. On v1 the writable backend remains `prd_tree/` until migration. Ordinary PRD mutations never write `prd.md`, branch-scoped `prd_*.md`, or `prd.json`; legacy conversion commands are explicit migration exceptions. Avoid parallel writers.

**Export carve-outs.** `ndx prd export` writes a JSON bundle, and
`--format=narrative` writes prose Markdown; both go to an operator-chosen
path outside `.rex/`, enforced in code, and neither is a PRD backend. The
bundle round-trips through `rex import-bundle`; the narrative is one-way and
lossy by construction — do not add a parser for it. (`ndx export` is a
different command: it publishes the static dashboard.) The export path must be
outside the resolved rex directory, including `.ndx/rex/` on the current layout.

**Public contract.** The [public surface](docs/architecture/public-surface.md)
declares the 0.9.0 soft freeze, 1.0.0 freeze and host-neutral merge requirements:
scoped tests, patch changesets, atomic code/PRD commits and final `N-DX-Item`
trailers. Experimental surfaces stay changeable until promoted.

<!-- ADDENDUM -->

### Package conventions

| Convention | Pattern | Notes |
|-----------|---------|-------|
| Naming | All packages are `@n-dx/` scoped (`@n-dx/core`, `@n-dx/rex`, `@n-dx/sourcevision`, `@n-dx/hench`, `@n-dx/llm-client`, `@n-dx/lang-*`, `@n-dx/web`) | The unscoped `rex` / `hench` / `sourcevision` / `sv` names are **bin aliases**, not package names — they exist so the CLIs can be invoked directly after install, not for `npx <name>`. Changesets must use the scoped name — an unscoped name fails `changeset status` with "not in the workspace" |
| Subpath exports | `"./dist/*": "./dist/*"` | Intentional escape hatch — not public API, no stability guarantee. See `PACKAGE_GUIDELINES.md` for acceptable/prohibited uses |

## Assistant Instruction Files

`ndx init` generates every assistant's instruction file from one source,
`packages/core/assistant-assets/project-guidance.md`. `AGENTS.md` is the
canonical shared surface: that guidance, filtered, plus the manifest-derived
workflow, skills and MCP sections and `codex-troubleshooting.md`. `CLAUDE.md`
is the same guidance plus `claude-addendum.md`. `.codex/config.toml` carries
the MCP server descriptors.

**Design invariant:** codebase documentation belongs in `project-guidance.md`;
only Claude Code's own behaviour belongs in `claude-addendum.md`, which never
reaches `AGENTS.md`. `tests/e2e/instruction-alignment.test.js` enforces this.

Re-run `ndx init` after editing `packages/core/assistant-assets/`.
`tests/e2e/agents-md-size-budget.test.js` limits root + nested instructions:
Codex drops their tail past `project_doc_max_bytes`. Put detail in `docs/`.

## n-dx Orchestration Commands

Run `ndx <command> --help` for full usage, or see `README.md` for the command reference and direct-tool-access aliases (`ndx rex`, `ndx hench`, `ndx sv`, or the standalone binaries).

**Gotcha:** `ndx work` autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) default `--permission-mode` to `acceptEdits` so the spawned Claude session won't stall in plan mode — override with `--permission-mode` or `hench.permissionMode`. This default is enforced repo-wide via the hench system prompt for all CLI-provider runs (see the `/no-plan-mode` skill).

**Gotcha:** `ndx iso` renders a standalone isometric architecture map. Its portable `/iso-map` skill script is **generated** from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` — edit the TypeScript and re-run it; hand-editing `.claude/skills/iso-map/scripts/iso-map.mjs` fails `tests/e2e/iso-skill-drift.test.js`. Injection seams and runtime infrastructure, which no import graph can show, are declared under `sourcevision.isoMap` in `.n-dx.json`; see [`docs/architecture/iso-map-data-flow.md`](docs/architecture/iso-map-data-flow.md).

**Extensions:** `ndx.extension` packages add `ndx <name>` commands and `/x/<name>/` hub apps, spawned and never imported. Contract: [`docs/extensions/`](docs/extensions/index.md).

## MCP Servers

Rex and sourcevision expose MCP servers over stdio (default) and HTTP (`ndx start`, which registers the repository with the per-user hub on port 3117). See `README.md` for full registration commands.

**stdio (default):** `ndx init` writes a tracked `.mcp.json` at the project root with cwd-relative commands (`ndx rex mcp .`, `ndx sv mcp .`) — committed to the repo, so every worktree and clone gets the same working registration. Claude Code shows a one-time approval prompt for a project's servers the first time it opens the checkout. If `ndx` isn't on `PATH`, use `npx -y @n-dx/core rex mcp .` / `npx -y @n-dx/core sv mcp .`, or re-run init with `--mcp-scope=local` to fall back to the older per-machine `claude mcp add --scope local` registration.

**Worktree sessions follow the client's roots:** the stdio rex and sourcevision servers (and `ndx mcp <server>` when it bridges to the hub) resolve their workspace from the client's MCP roots (`roots/list`), not only from the directory they were started in. Claude desktop starts a worktree session's project servers in the main checkout while the session itself runs in `<repo>/.claude/worktrees/<name>`; without roots, `.` would resolve to the main checkout and writes would land in the wrong PRD (#499). When the client's worktree cannot be served (a root outside the repository, or unresolvable), writes are refused with an error rather than misrouted. Verify a session's write target with rex `get_capabilities`: `workspace.source` reads `roots` when the client's root was used (`startup` means the launch directory), `workspace.projectDir` names the tree being written, and `workspace.refused` is set while writes are refused.

**HTTP — through the hub:** `ndx start .` registers the repository with the per-user hub and serves it at `http://localhost:3117/p/<id>/`, so each project's endpoints are `…/p/<id>/mcp/rex` and `…/p/<id>/mcp/sourcevision` and several projects share the port without collision. While exactly one project is registered the bare `http://localhost:3117/mcp/rex` still aliases to it; with several, root MCP calls answer `409` listing the ids. HTTP uses [Streamable HTTP](https://modelcontextprotocol.io/) with session management (`Mcp-Session-Id` header, created automatically on first request); the hub proxies, and each project's own server owns its sessions.

**Per-user token:** `ndx start` creates `<ndx home>/auth.token` (mode 0600) and every hub, dashboard and preview request must present it as `X-Ndx-Token`, `Authorization: Bearer`, or the `ndx_token` cookie that the printed URL sets once. HTTP MCP registrations therefore need `--header "X-Ndx-Token: $(cat ~/.ndx/auth.token)"`. Disable with `ndx start --no-auth` or `web.auth: false` in `.n-dx.json`.

**Migrating from stdio to HTTP (Claude):** register with the hub (`ndx start .`), read the project id from the URL it prints (or `ndx hub status`), remove the stdio registrations (`claude mcp remove rex && claude mcp remove sourcevision`), then add the HTTP ones (`claude mcp add --transport http rex http://localhost:3117/p/<id>/mcp/rex`, same for sourcevision).

### Rex MCP tools

- `get_prd_status` — PRD title and layout-specific progress; on v2, changes, Inbox and product status
- `get_next_task` — next actionable task based on priority and dependencies (skips tasks another worktree has claimed)
- `claim_task` — hold a task for this worktree so other worktrees skip it
- `release_task` — give back a claim without changing the task's status
- `update_task_status` — update item status
- `add_item` — v2: add a change, task or subtask with `type`; v1: use `level` (optional `run` settings: portable `tier` plus per-vendor `models` pins)
- `edit_item` — edit item content (title, description, priority, tags, `assignee` — empty string removes it, `run` — an object replaces the whole saved run block, `null` removes it; tier/models, never a bare model id)
- `get_item` — full item details with parent chain
- `move_item` — reparent an item in the PRD tree
- `merge_items` — consolidate duplicate sibling items
- `get_recommendations` — sourcevision-based recommendations
- `verify_criteria` — map acceptance criteria to test files
- `reorganize` — detect and fix structural issues
- `health` — PRD structure health score
- `facets` — list configured facets with distribution
- `append_log` — write structured log entry
- `get_token_usage` — roll up hench run token totals per PRD item (self/descendants/total) with orphans surfaced separately
- `get_capabilities` — server capabilities and configuration, plus the `workspace` block (`projectDir`, `source`, `refused`) naming the tree this session writes
- `get_product`, `get_capability` — v2 standing requirements, capability criteria and derived status
- `place_change`, `apply_change` — v2 placement and application of amendments to the product layer

> **`ndx work` applies a saved `run` block.** Precedence per setting: CLI flag > the task's `run` > `hench.*` > `llm.*` > default, resolved per task after selection — so in `--loop` / `--iterations` / `--epic-by-epic` each task uses its own saved settings, while an explicit flag applies to every task in the loop. A saved `provider` picks the cli or api loop for that task. `--no-review` and `--no-skip-test-gate` turn a saved setting off for one run. A saved value the active vendor cannot honour is skipped with a warning and never stops a loop; a malformed block is ignored whole. `ndx work --task=<id> --resolve .` prints every setting with the key that supplied it (`task.run` when the saved block won), the `saved` block itself, and each saved setting's `fallback`.

### Sourcevision MCP tools

- `get_overview` — project summary statistics
- `get_next_steps` — prioritized improvement recommendations
- `get_zone` — architectural zone details
- `get_findings` — analysis findings (anti-patterns, suggestions, observations)
- `get_file_info` — file inventory entry, zone, and imports
- `search_files` — search inventory by path, role, or language
- `get_imports` — import graph edges
- `get_classifications` — file archetype classifications
- `set_file_archetype` — override archetype classification for a file
- `get_route_tree` — route structure (pages, API routes, layouts)
- `get_readiness` — SDLC readiness scorecard (tests, CI, CD, rollback, migrations, feature flags, quality gates, observability, agent safety), scored from `sdlc-profile.json`. Heuristic: it detects whether a practice exists and is wired up, not whether it is good

## Changeset Versioning

- **Always default changeset bumps to `patch`** across all affected packages unless explicitly instructed otherwise by a user.
- **Use the scoped package name** (`@n-dx/rex`, `@n-dx/hench`, …) in changeset frontmatter. An unscoped name is not in the workspace and fails `changeset status`, breaking the release pipeline.

## Key Files

| Path | Purpose |
|------|---------|
| `.ndx/rex/product/`, `.ndx/rex/changes/` | v2 PRD roots; `.rex/product/` and `.rex/changes/` on the legacy directory layout |
| `.rex/prd_tree/` | v1 backend, retained only for projects not yet migrated |
| `.rex/prd.md` | (Legacy) flat Markdown PRD; migration source for `rex migrate-to-folder-tree`. Absent after migration. |
| `.rex/prd.json` | (Legacy) JSON PRD; migration source when neither `prd.md` nor the tree exists. |
| `.rex/execution-log.jsonl` | Append-only structured activity log (rotates to `.rex/execution-log.1.jsonl` at 1 MB) |
| `.n-dx.json` | Project-level config overrides (web.port, llm.vendor, llm.claude.model, llm.codex.model) |
| `OPEN_SOURCE_SCOPE.md` | Licensing boundaries, included/excluded components, and contribution expectations |

The policy suites that enforce the rules above — spawn-only and intra-package
layering (`architecture-policy`), gateway and tier isolation
(`domain-isolation`), MCP transport, integration coverage — live under
`tests/e2e/`. `tests/e2e/cli-dev.test.js` and
`tests/integration/scheduler-startup.test.js` are required on every change:
see [TESTING.md](TESTING.md#required-tests).

Derived files an assistant never edits — the sourcevision caches, the hench
usage cursors, the archive and the dashboard spend ledger — are described in
[docs/architecture/generated-files.md](docs/architecture/generated-files.md).
All of them are machine-local and safe to delete.

> **PRD layout.** V2 changes always have `index.md` folders; other nodes use folders with children and `<slug>.md` leaves. `state.yaml` keeps tool state apart. Never commit the rex directory's dashboard-derived `.cache/prd.json` or use it as a backend. See the [v2 schema](docs/architecture/prd-folder-tree-schema.md).
