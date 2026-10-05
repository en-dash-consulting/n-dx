# CLI ↔ Dashboard Coverage Gap Inventory

_Last updated: 2026-08-24_

## Methodology

Every user-facing capability — ndx orchestration commands, rex / sourcevision / hench package CLI commands, and rex / sourcevision MCP tools — is rated:

- **full** — dashboard has a trigger, status view, and configuration surface for this capability
- **partial** — dashboard exposes some but not all meaningful facets (read-only view without trigger, trigger without config, or a subset of the CLI's options)
- **none** — no dashboard representation at all
- **n/a** — intentionally terminal-only or not meaningful inside the dashboard (rationale given)

"User impact" is rated **high / medium / low** based on how frequently the capability appears in a normal daily workflow.

Coverage was verified against the current viewer (`packages/web/src/viewer/views/view-registry.ts`, `components/sidebar.ts`) and server routes (`packages/web/src/server/routes-*.ts`), including the trigger controls shipped in `feat(web): add dashboard trigger controls for CLI commands` (`/api/commands/*`).

---

## Changes since the 2026-04-18 audit

The Dashboard Trigger Controls feature closed five of the previous Tier 1–3 gaps:

| Command | Was | Now | Shipped surface |
|---------|-----|-----|-----------------|
| `ndx analyze` | none | **full** | "Run Analysis" button on Overview → POST `/api/commands/sv-analyze` (lite/full) |
| `ndx sync` | none | **full** | Push / Pull / Sync buttons in ndx sync settings → POST `/api/commands/sync` |
| `ndx recommend` | partial | **full** | "Refresh Recommendations" on Suggestions → POST `/api/commands/recommend` |
| `ndx export` | none | **partial** | Export panel in Commands view → POST `/api/commands/export` (no `--deploy=github` flow) |
| `ndx self-heal` | none | **partial** | Self-Heal panel in Commands view → POST `/api/commands/self-heal` + status poll (no live phase/iteration view, no stop control) |

One capability **regressed**: the Analyze/Batch-Import panels (`ndx plan` proposal review) are no longer reachable — see [Orphaned UI surface](#orphaned-ui-surface).

---

<!-- BEGIN GENERATED: command-effects (scripts/build-cli-ui-gap.mjs) -->

## Command effects

_Generated from `packages/core/command-effects.js` — the same declarations the terminal preflight banner prints and `GET /api/commands/manifest` serves. Edit the declarations, then run `node scripts/build-cli-ui-gap.mjs`._

Paths the layout owns are written as tokens: `{rex}` = `.rex` (`.ndx/rex` on the .ndx layout), `{hench}` = `.hench` (`.ndx/hench` on the .ndx layout), `{sourcevision}` = `.sourcevision` (`.ndx/sourcevision` on the .ndx layout), `{config}` = `.n-dx.json` (`.ndx/config.json` on the .ndx layout), `{localConfig}` = `.n-dx.local.json` (`.ndx/config.local.json` on the .ndx layout), `{webPid}` = `.n-dx-web.pid` (`.ndx/web.pid` on the .ndx layout), `{webPort}` = `.n-dx-web.port` (`.ndx/web.port` on the .ndx layout).

| Command | Writes | LLM phases (calls) | Network | Takes |
|---------|--------|--------------------|---------|-------|
| `ndx init` | `{rex}/, {hench}/, {sourcevision}/`<br>`{config}, .gitignore, .gitattributes`<br>CLAUDE.md, AGENTS.md, .claude/, .agents/, .codex/, .mcp.json<br>README.md<br>`~/.claude.json` (only with --mcp-scope=local)<br>`.git/` (only with --git, or on a TTY when the preflight prompt is accepted) | auth probe ~0-1 | llm-provider | under a minute |
| `ndx migrate-layout` | `.ndx/`<br>`.gitignore, .gitattributes`<br>git commits (only without --no-commit) | none | none | seconds |
| `ndx analyze` | `{sourcevision}/` | classify ~0-N batches of 30 files<br>zones ~1-2 per batch of 7 zones; more passes with --full<br>primer ~0-1<br>narration ~1 per escalated zone<br>_none with `--fast`_ | llm-provider | under a minute on a small repo; several minutes with --deep or --full |
| `ndx recommend` | `{rex}/acknowledged-findings.json` (only with --acknowledge)<br>`{rex}/prd_tree/` (only with --accept) | none | none | seconds |
| `ndx plan` | `{sourcevision}/`<br>`{rex}/pending-proposals.json`<br>`{rex}/prd_tree/` (only with --accept) | classify ~0-N batches of 30 files<br>zones ~1-2 per batch of 7 zones; more passes with --full<br>primer ~0-1<br>narration ~1 per escalated zone<br>proposals ~1 per proposal batch<br>decomposition ~0-1 per oversized proposal<br>_none with `--no-llm`_ | llm-provider | a few minutes — it runs a full analysis first |
| `ndx add` | `{rex}/pending-smart-proposals.json`<br>`{rex}/prd_tree/` (only with --accept or --title, or when accepted at the prompt)<br>`{rex}/execution-log.jsonl` | smart add ~1 (none with --title)<br>consolidation ~0-2 | llm-provider (only without --title) | seconds to under a minute |
| `ndx refresh` | `{sourcevision}/` (only without --ui-only)<br>`{sourcevision}/dashboard-artifacts.json`<br>the dashboard build (only without --data-only or --no-build) | classify ~0-N batches of 30 files<br>zones ~1-2 per batch of 7 zones; more passes with --full<br>primer ~0-1<br>narration ~1 per escalated zone<br>_none with `--fast` or `--ui-only`_ | llm-provider<br>localhost (only with --live-server) | a minute to several minutes |
| `ndx work` | source files<br>git commits (only when autoCommit is on, the default)<br>`{hench}/runs/`<br>`{rex}/prd_tree/`<br>`{rex}/execution-log.jsonl`<br>`<git-common-dir>/ndx/claims.json` | agent ~1 agent session per task<br>review ~0-1 per task<br>commit message ~0-1<br>_none with `--dry-run`_ | llm-provider | minutes per task; --loop runs until the queue is empty |
| `ndx status` | nothing (read-only) | none | none | seconds |
| `ndx usage` | nothing (read-only) | none | none | seconds |
| `ndx claim` | `<git-common-dir>/ndx/claims.json` (only on release) | none | none | seconds |
| `ndx sync` | `{rex}/prd_tree/` (only without --push)<br>`{rex}/execution-log.jsonl`<br>the remote tracker (only without --pull or --dry-run) | none | remote | seconds to a minute |
| `ndx start` | `{webPid} and {webPort}`<br>`~/.ndx/hub.json`<br>`~/.ndx/auth.token` | none | localhost | long-running server; hub mode returns once registered |
| `ndx install-sample` | `sample-app/`<br>`{rex}/prd_tree/sample-app-improvements/` | none | none | seconds |
| `ndx destroy-sample` | `sample-app/`<br>`{rex}/prd_tree/` | none | none | seconds |
| `ndx dev` | the dashboard build | none | localhost | until stopped |
| `ndx web` | `{webPid} and {webPort}`<br>`~/.ndx/hub.json`<br>`~/.ndx/auth.token` | none | localhost | long-running server; hub mode returns once registered |
| `ndx ci` | `{sourcevision}/` | none | none | minutes |
| `ndx which` | nothing (read-only) | none | none | seconds |
| `ndx config` | `{config}, {localConfig}, {rex}/config.json, {hench}/config.json` (only when setting a value) | auth probe ~0-1 | llm-provider (only when setting llm.vendor, or with --test-connection) | seconds |
| `ndx auth` | nothing (read-only) | auth probe ~1 | llm-provider | seconds |
| `ndx export` | `ndx-export/`<br>`.gitignore`<br>the n-dx-dashboard branch (only with --deploy=github) | none | remote (only with --deploy=github) | seconds to a minute |
| `ndx prd` | the --out file (only on export)<br>`{rex}/prd_tree/` (only on import)<br>`{rex}/.backups/` (only on import, without --no-snapshot) | none | none | seconds |
| `ndx trust` | `~/.ndx/trust/` (only on accept or revoke) | none | none | seconds |
| `ndx self-heal` | `{sourcevision}/`<br>`{rex}/prd_tree/`<br>`{rex}/acknowledged-findings.json`<br>source files (only without --capture-only)<br>git commits (only without --capture-only)<br>`{hench}/runs/` (only without --capture-only) | analysis ~several per zone batch, per iteration<br>agent ~1 agent session per task | llm-provider | long — tens of minutes to hours |
| `ndx pair-programming` | `{rex}/prd_tree/`<br>`{hench}/runs/`<br>source files | agent ~1 agent session<br>review ~1-2 reviewer sessions<br>remediation ~0-1 agent session | llm-provider | minutes to tens of minutes |
| `ndx bicker` | `{rex}/prd_tree/`<br>`{hench}/runs/`<br>source files | agent ~1 agent session<br>review ~1-2 reviewer sessions<br>remediation ~0-1 agent session | llm-provider | minutes to tens of minutes |
| `ndx validate` | `{rex}/prd_tree/` (only with --post-merge --repair, or when a fix is accepted at the prompt) | none | none | seconds |
| `ndx fix` | `{rex}/prd_tree/` (only without --dry-run) | none | none | seconds |
| `ndx health` | nothing (read-only) | none | none | seconds |
| `ndx report` | nothing (read-only) | none | none | seconds |
| `ndx verify` | nothing (read-only) | none | none | seconds to two minutes |
| `ndx log` | `{rex}/execution-log.jsonl` | none | none | seconds |
| `ndx update` | `{rex}/prd_tree/`<br>`{rex}/execution-log.jsonl` | none | none | seconds |
| `ndx remove` | `{rex}/prd_tree/`<br>`{rex}/execution-log.jsonl` | none | none | seconds |
| `ndx move` | `{rex}/prd_tree/`<br>`{rex}/execution-log.jsonl` | none | none | seconds |
| `ndx reshape` | `{rex}/.backups/`<br>`{rex}/prd_tree/` (only with --accept)<br>`{rex}/archive.json` (only with --accept) | proposals ~1-N<br>merge bodies ~0-N | llm-provider | a minute to several minutes |
| `ndx reorganize` | `{rex}/.backups/`<br>`{rex}/prd_tree/` (only with --accept or --accept-llm) | proposals ~0-N<br>_none with `--fast` or `--mode=fast`_ | llm-provider | about a minute |
| `ndx prune` | `{rex}/.backups/`<br>`{rex}/prd_tree/` (only without --dry-run)<br>`{rex}/archive.json` (only without --dry-run) | consolidation ~0-1 (none with --no-consolidate) | llm-provider | seconds to a minute |
| `ndx next` | nothing (read-only) | none | none | seconds |
| `ndx tree` | nothing (read-only) | none | none | seconds |
| `ndx tree-diff` | nothing (read-only) | none | none | seconds |
| `ndx reset` | `{sourcevision}/` | none | none | seconds |
| `ndx show` | nothing (read-only) | none | none | seconds |
| `ndx rex` | `{rex}/` (only for a subcommand that writes) | subcommand ~varies | llm-provider (only for a subcommand that calls a model) | depends on the subcommand |
| `ndx hench` | `{hench}/` (only for a subcommand that writes) | subcommand ~varies | llm-provider (only for a subcommand that calls a model) | depends on the subcommand |
| `ndx sourcevision` | `{sourcevision}/` (only for a subcommand that writes) | subcommand ~varies | llm-provider (only for a subcommand that calls a model) | depends on the subcommand |
| `ndx sv` | `{sourcevision}/` (only for a subcommand that writes) | subcommand ~varies | llm-provider (only for a subcommand that calls a model) | depends on the subcommand |

<!-- END GENERATED: command-effects -->

---

## ndx orchestration commands

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `ndx work` | **full** | high | Per-task Execute button (task detail), "Start" on next-task card, epic-by-epic panel with pause/resume, terminate + throttle/emergency-stop controls |
| `ndx analyze` | **full** | high | "Run Analysis" on Overview (lite/full); `--deep` not exposed |
| `ndx sync` | **full** | high | Push/pull/sync triggers + Notion config, connection test, schema wizard |
| `ndx recommend` | **full** | high | Suggestions view + refresh trigger |
| `ndx plan` / `--accept` | **partial** | high | **Regression:** smart-add preview + accept-edited work (SmartAddInput), but the proposal-review panel (`AnalyzePanel` → `/api/rex/analyze`, `/api/rex/proposals*`) is only mounted by the orphaned `views/analysis.ts` |
| `ndx add` | full | high | Smart-add input with debounced preview, accept-edited flow |
| `ndx status` | full | high | Rex dashboard + PRD tree |
| `ndx usage` | **full** | high | Period grouping (day/week/month toggle), per-command breakdown with package filter, and budget alerts by severity — all served by the aggregate `/api/token/utilization` endpoint |
| `ndx refresh` | **partial** | high | "Refresh Data" panel triggers the data phases live (`--data-only --live-server`); full UI rebuild still requires the terminal (server must stop) |
| `ndx self-heal` | **full** | medium | Trigger, status poll, iteration/phase display, and a Stop control that cancels the running loop |
| `ndx export` | partial | medium | Export trigger exists; deploy flow not exposed |
| `ndx ci` | **full** | medium | Run-CI-check action in the Validation view with structured results from `--format=json` |
| `ndx config` | full | medium | Three settings pages: Robot Wrangler (vendor, provider and model), Workflow (work settings, templates, CLI timeouts) and Project (analyze/plan settings, feature flags, Notion, integrations) |
| `ndx auth` | **full** | low | Credential status chip on Robot Wrangler (GET `/api/commands/auth`), with re-check |
| `ndx install-sample` / `ndx destroy-sample` | **full** | low | Sample App panel in Commands view (`packages/web/src/viewer/views/commands.ts`) — Install/Destroy buttons, live status polling via GET `/api/commands/sample-status`, POST `/api/commands/install-sample` and `/api/commands/destroy-sample` |
| `ndx pair-programming` / `bicker` | none | low | Experimental; not yet a dashboard workflow |
| `ndx init` | n/a | — | One-time setup; dashboard requires init to exist |
| `ndx start` / `ndx dev` | n/a | — | These commands launch the dashboard |
| `ndx version` / `ndx help` | n/a | — | Footer version + Guide/FAQ views cover this |

### `ndx config` — Robot Wrangler view detail

- **Local vendor (full):** the Robot Wrangler view (`packages/web/src/viewer/views/robot-wrangler.ts`) adds a "local" vendor alongside Claude/Codex — host/port/model fields, a live status probe, a connection smoke test (latency + tokens/sec), and saved server profiles. Backed by GET/PUT `/api/llm/config` plus GET `/api/llm/local-status`, POST `/api/llm/local-test`, and GET/POST/DELETE `/api/llm/local-profiles` (`packages/web/src/server/routes-llm.ts`).
- **Providers and models (full):** each vendor offers only the providers hench accepts and a model dropdown over the server's catalog (GET `/api/llm/catalog`, `?refresh=true` to re-fetch). The agent model saves as `hench.models.<vendor>` through PUT `/api/llm/config`; the provider saves through PUT `/api/hench/config`. The page shows the installed CLI version for Claude and Codex but offers no update or install action.

## rex package CLI

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `rex status` / `tree` | full | high | PRD tree view |
| `rex next` | full | high | Next-task card on Rex dashboard |
| `rex add` (manual + smart) | full | high | Inline add + smart-add |
| `rex update` / `remove` / `move` | full | medium | Inline status picker, bulk actions, delete, reparent |
| `rex validate` | full | medium | Validation view re-fetches `/api/rex/validate` + dependency graph with cycle detection |
| `rex health` | full | medium | Health gauge on dashboard |
| `rex reorganize` | full | medium | Reorganize panel with preview + apply |
| `rex prune` | full | medium | Prune preview + confirmation + execute |
| `rex reshape` | **full** | medium | Reshape action in the Validation view: previews proposals via `--dry-run`, applies only on explicit confirm |
| `rex fix` | **full** | medium | Fix action in the Validation view: `--dry-run` preview, then apply, then automatic re-validation |
| `rex restore` | **full** | high | Snapshots/Restore panel on the Rex dashboard (list + restore-with-confirmation) — GET `/api/rex/backups`, POST `/api/rex/restore` (`routes-rex/restore.ts`). The in-app undo for `reorganize`/`prune`/`reshape`/`fix` |
| `rex verify` | **full** | medium | Requirements page renders coverage + traceability matrix (per-item CRUD deferred to the task detail panel) |
| `rex analyze` / `import` | partial | medium | Same orphaned-panel regression as `ndx plan` |
| `rex usage` | full | medium | Same coverage as `ndx usage` |
| `rex sync` | full | medium | Via sync triggers |
| `rex adapter` | partial | low | The Project settings page provides schema-driven config for registered adapters; no add/remove |
| `rex report` | none | low | JSON for CI; health view covers interactive use |
| `rex facets` (MCP `facets`) | partial | low | **Deferred by decision (2026-08-14).** Facet filters exist in the PRD tree. A distribution view was scoped and skipped: `facets` is MCP-only (no CLI command), no facets are configured in this project, and the panel would render an empty state for most users. Revisit if facet configuration becomes common. |
| `rex migrate-to-md` / `migrate-folder-tree-filenames` / `backfill-commit-attribution` | n/a | — | One-time migrations; terminal-only by design |
| `rex mcp` | n/a | — | Server plumbing; MCP HTTP endpoints served by the dashboard itself |

## sourcevision package CLI

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `sourcevision analyze` | full | high | Run Analysis trigger + eight data views |
| `sourcevision pr-markdown` | full | medium | PR Markdown tab with per-section copy + freshness state |
| `sourcevision validate` | none | low | No UI to validate `.sourcevision/` outputs; freshness indicator partially covers intent |
| `sourcevision export-pdf` | **full** | medium | "Export PDF report" beside the Export panel; reports the written path (the viewer sandbox blocks page-initiated downloads) |
| `sourcevision workspace` | none | low | Multi-repo aggregation has no dashboard concept yet; `GET /api/worktrees` covers worktrees of the served repo only, and cross-project switching is the 0.7.0 hub's job |
| `sourcevision serve` | n/a | — | Legacy standalone viewer; superseded by `ndx start` |
| `sourcevision reset` | n/a | — | Destructive; intentionally terminal-only |
| `sourcevision git-credential-helper` | n/a | — | Interactive terminal flow |
| `sourcevision mcp` | n/a | — | Server plumbing |

## hench package CLI

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `hench run` | full | high | Execute buttons + epic-by-epic panel (see `ndx work`) |
| `hench status` / `show` | full | medium | Runs view: history, transcript, token breakdown, files changed |
| `hench config` | full | medium | Workflow settings page (GET/PUT `/api/hench/config`); provider and model live on Robot Wrangler |
| `hench template` | full | medium | Templates view: gallery, apply, save, delete |
| `hench validate-tokens` | **full** | low | "Validate token reporting" trigger in the Runs view, beside the per-run token diagnostics |
| `hench record` | n/a | — | Plumbing for the assisted-run skills (`/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config`); reads its token usage from the Claude Code session transcript |
| `hench init` | n/a | — | Covered by `ndx init` |

## Rex MCP tools (17)

MCP tools are AI-assistant-facing; the dashboard need not mirror them 1:1. Coverage below records whether an equivalent human surface exists, since a capability reachable by agents but invisible to humans is an observability gap.

| Tool | Equivalent UI | Coverage |
|------|---------------|----------|
| `get_prd_status` | Rex dashboard stats + PRD tree | full |
| `get_next_task` | Next-task card | full |
| `update_task_status` | Inline status picker / bulk actions | full |
| `add_item` | Add-item + smart-add | full |
| `edit_item` | Detail panel editing | full |
| `get_item` | Detail panel | full |
| `move_item` | Tree reparent | full |
| `merge_items` | Merge preview | full |
| `get_recommendations` | Suggestions view | full |
| `verify_criteria` | Requirements page (coverage + traceability matrix) | full |
| `reorganize` | Reorganize panel | full |
| `health` | Health gauge | full |
| `facets` | Facet filters (no distribution view) | partial |
| `append_log` | Activity view (REX → Activity) renders the log | full |
| `sync_with_remote` | Sync triggers | full |
| `get_token_usage` | Token Usage view (utilization only) | partial |
| `get_capabilities` | — | n/a (protocol handshake) |

## Sourcevision MCP tools (10)

| Tool | Equivalent UI | Coverage |
|------|---------------|----------|
| `get_overview` | Overview tab | full |
| `get_next_steps` | Next Steps panel on Overview (derived steps, any pass) + Suggestions tab | full |
| `get_zone` | — | **none** — the zone-detail view (`views/zones.ts`, 2569 lines) exists but is unreachable (see orphaned surface) |
| `get_findings` | Architecture / Problems / Suggestions tabs | full |
| `get_file_info` | Files tab | full |
| `search_files` | Files tab filters + global search overlay | full |
| `get_imports` | Map tab | full |
| `get_classifications` | Files tab Archetype column (via `/api/sv/classifications`) | full |
| `set_file_archetype` | Archetype override control in the Files tab (POST `/api/sv/archetype`) | full |
| `get_route_tree` | Routes tab | full |

---

## Orphaned UI surface — resolved 2026-08-12

Roughly 2,900 lines of built view code were unreachable; both views are now registered (guarded by `tests/unit/viewer/restored-views.test.ts`):

1. **`views/analysis.ts` (`AnalysisView`)** — was never registered after the web-package extraction, leaving POST `/api/rex/analyze`, `/api/rex/proposals*`, and `/api/rex/batch-import` without reachable UI. Now `analysis` (REX → "Analyze & Import").
2. **`views/zones.ts` (`ZonesView`, 2569 lines)** — removed from navigation in PR #189 ("obsolete Zones navigation") before PRs #317/#321 invested in expandable zones and a11y, leaving that feature work invisible. Now `zones` (SourceVision → "Zones" tab).

## Server APIs with no UI consumer

| API surface | Size | Note |
|-------------|------|------|
| ~~`/api/hench/adaptive/*`~~ | 873 lines, 10 endpoints | **Done 2026-08-13**: Adaptive Optimization view (HENCH → Adaptive) consumes all 10 endpoints |
| ~~`/api/rex/requirements/*`~~ | 575 lines | **Done 2026-08-13**: Requirements page (REX → Requirements) renders coverage + traceability; per-item CRUD deferred to the task detail panel |
| `/api/sv/*` (all except `pr-markdown`) | 8 endpoints | Viewer reads `/data/*.json` directly; these serve external/MCP consumers — **document as external API, not a UI gap** |
| `/api/token/{summary,events,by-command,by-period,budget}` | 5 endpoints | **Not a UI gap (verified 2026-08-14).** `utilization` returns `commands`, `budget` and `trend` in one response, and the Token Usage view already renders all three — a day/week/month toggle (`ndx usage --group` parity), a per-command table with package filtering, and budget alerts by severity. These five are the granular/external split of the same data; wiring them separately would duplicate working UI and add redundant requests. |
| `/api/hench/{metrics,metrics/snapshots,memory/history,memory/leaks,runs/health}` | 5 endpoints | Panels exist for live memory/concurrency; historical metrics unexposed |
| `/api/rex/{next,stats}` | 2 endpoints | Dashboard consumes `/api/rex/dashboard` instead; candidates for removal or documentation |

## SourceVision full-flow note — trigger shipped 2026-08-12

The SourceVision tabs are gated by `zones.enrichmentPass` (Architecture ≥ 2, Problems ≥ 3, Suggestions ≥ 4). The Overview now has a **"Full analysis"** control that runs `sourcevision analyze --full` (all four enrichment passes) as a background job — POST `/api/commands/sv-analyze` with `full: true` returns 202 and progress streams via `GET /api/commands/sv-analyze/status` (30-minute budget for the LLM passes; the old synchronous path capped out at 3 minutes). Locked tabs unlock automatically as the viewer's data polling picks up the refreshed `zones.json`. Remaining scope for the feature lives in its second task: surfacing every recommendation/function per tab once data exists.

---

## Priority-ordered gap list

### Tier 1 — high impact

1. ~~**Restore the orphaned `AnalysisView`**~~ — **done 2026-08-12**: registered as `analysis` (REX → "Analyze & Import"); `ndx plan` proposal review is reachable again.
2. ~~**Restore the orphaned `ZonesView`**~~ — **done 2026-08-12**: registered as `zones` (SourceVision → "Zones" tab); zone drill-down (`get_zone` equivalent) is navigable.
3. ~~**`ndx refresh` trigger**~~ — **done 2026-08-12**: "Refresh Data" panel in the Commands view → POST `/api/commands/refresh` (spawns `ndx refresh --data-only --live-server`, a new CLI mode that keeps the running server alive) with phase progress from the `[refresh]` output and a status poll endpoint.
4. **Full-flow analysis trigger** — extend `/api/commands/sv-analyze` to drive deep/enrichment passes with per-pass progress so all SourceVision tabs unlock from the UI (feeds feature `a83b1a2f`).

### Tier 2 — medium impact

5. ~~**Requirements / traceability page**~~ — **done 2026-08-13** (REX → Requirements: coverage stats + expandable traceability matrix).
6. ~~**Adaptive-optimization page**~~ — **done 2026-08-13** (HENCH → Adaptive view: metrics, apply/dismiss/lock, settings, overrides, history).
7. ~~**`rex fix` action**~~ — **done 2026-08-14** (Validation view, dry-run preview then apply).
8. ~~**`rex reshape` flow**~~ — **done 2026-08-14** (preview proposals, apply on confirm).
9. ~~**`ndx ci` trigger**~~ — **done 2026-08-14** (async run with structured JSON results).
10. ~~**Token usage depth**~~ — **closed 2026-08-14, no work needed**: the capabilities were already present via `utilization` (see the API table). The audit had flagged unused *endpoints*, not missing features.
11. ~~**Self-heal live view**~~ — **done 2026-08-14**: iteration/phase display parsed from loop output, plus a Stop control (new `POST /api/commands/self-heal/stop`, backed by AbortSignal support added to the foundation `exec`).

### Tier 3 — low impact

12. ~~**`sourcevision export-pdf` control**~~ — **done 2026-08-14**.
13. ~~**`set_file_archetype` override UI**~~ — **done 2026-08-12** (Files tab Archetype column with override control).
14. ~~**Facet distribution view**~~ — **deferred 2026-08-14** with rationale (see the rex CLI table): MCP-only, unconfigured in practice, would render empty for most projects.
15. ~~**`ndx auth` status chip**~~ — **done 2026-08-14** (Settings → General).
16. ~~**`hench validate-tokens` trigger**~~ — **done 2026-08-14**.
17. ~~**Execution-log viewer**~~ — **done 2026-08-14**: REX → Activity renders the full log with event filtering and search.

## Intentionally terminal-only (excluded)

| Capability | Rationale |
|-----------|-----------|
| `ndx start` / `ndx dev` | These launch the dashboard |
| `ndx init` / `hench init` / `rex init` / `sourcevision init` | One-time setup; dashboard presupposes init |
| `ndx version` / `ndx help` | Footer version, Guide + FAQ views |
| `sourcevision reset` | Destructive, low frequency |
| `sourcevision serve` | Superseded by `ndx start` |
| `sourcevision git-credential-helper` | Interactive terminal flow |
| `rex migrate-*` / `backfill-commit-attribution` | One-time migrations |
| `rex mcp` / `sourcevision mcp` | Transport plumbing; HTTP MCP is served by the dashboard |
| `hench record` | Skill-integration plumbing (writes the run record, and the tokens the skill spent) |
| MCP `get_capabilities` | Protocol handshake |
| `/api/sv/*` read endpoints | External/MCP-facing API by design; viewer reads `/data/*.json` |
