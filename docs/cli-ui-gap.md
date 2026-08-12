# CLI ↔ Dashboard Coverage Gap Inventory

_Last updated: 2026-08-12_

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
|  `ndx usage` | **partial** | high | Token Usage view consumes only `/api/token/utilization`; `by-period` (day/week/month grouping), `by-command`, `budget`, `events` endpoints exist but have no UI |
| `ndx refresh` | **partial** | high | "Refresh Data" panel triggers the data phases live (`--data-only --live-server`); full UI rebuild still requires the terminal (server must stop) |
| `ndx self-heal` | partial | medium | Trigger + status poll exist; no live phase display or stop control |
| `ndx export` | partial | medium | Export trigger exists; deploy flow not exposed |
| `ndx ci` | **none** | medium | No trigger or results view |
| `ndx config` | full | medium | Settings section: General (LLM provider), project settings, hench config, Notion, feature flags, CLI timeouts — grouped by CLI command |
| `ndx auth` | none | low | Credential check is terminal-adjacent; a status chip in LLM settings would suffice |
| `ndx pair-programming` / `bicker` | none | low | Experimental; not yet a dashboard workflow |
| `ndx init` | n/a | — | One-time setup; dashboard requires init to exist |
| `ndx start` / `ndx dev` | n/a | — | These commands launch the dashboard |
| `ndx version` / `ndx help` | n/a | — | Footer version + Guide/FAQ views cover this |

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
| `rex reshape` | **none** | medium | LLM restructuring has no dashboard entry point (high-risk op that would benefit from a diff-preview flow) |
| `rex fix` | **none** | medium | Validation view shows issues but offers no fix action |
| `rex verify` | **partial** | medium | Requirements CRUD/coverage/traceability API exists (`routes-rex/requirements.ts`, 575 lines) with **no page** consuming it |
| `rex analyze` / `import` | partial | medium | Same orphaned-panel regression as `ndx plan` |
| `rex usage` | partial | medium | Same gaps as  `ndx usage` |
| `rex sync` | full | medium | Via sync triggers |
| `rex adapter` | partial | low | Integrations view provides schema-driven config for registered adapters; no add/remove |
| `rex report` | none | low | JSON for CI; health view covers interactive use |
| `rex facets` (MCP `facets`) | partial | low | Facet filters in PRD tree; no facet-distribution view |
| `rex migrate-to-md` / `migrate-folder-tree-filenames` / `backfill-commit-attribution` | n/a | — | One-time migrations; terminal-only by design |
| `rex mcp` | n/a | — | Server plumbing; MCP HTTP endpoints served by the dashboard itself |

## sourcevision package CLI

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `sourcevision analyze` | full | high | Run Analysis trigger + eight data views |
| `sourcevision pr-markdown` | full | medium | PR Markdown tab with per-section copy + freshness state |
| `sourcevision validate` | none | low | No UI to validate `.sourcevision/` outputs; freshness indicator partially covers intent |
| `sourcevision export-pdf` | **none** | medium | No export-as-PDF control; natural fit next to the existing Export panel |
| `sourcevision workspace` | none | low | Multi-repo aggregation has no dashboard concept yet (project switcher `/api/projects` is single-repo) |
| `sourcevision serve` | n/a | — | Legacy standalone viewer; superseded by `ndx start` |
| `sourcevision reset` | n/a | — | Destructive; intentionally terminal-only |
| `sourcevision git-credential-helper` | n/a | — | Interactive terminal flow |
| `sourcevision mcp` | n/a | — | Server plumbing |

## hench package CLI

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `hench run` | full | high | Execute buttons + epic-by-epic panel (see `ndx work`) |
| `hench status` / `show` | full | medium | Runs view: history, transcript, token breakdown, files changed |
| `hench config` | full | medium | ndx work settings view (GET/PUT `/api/hench/config`) |
| `hench template` | full | medium | Templates view: gallery, apply, save, delete |
| `hench validate-tokens` | none | low | Vendor token-accuracy check; diagnostics already shown per-run — trigger could live in Runs view |
| `hench record` | n/a | — | Plumbing for the /ndx-work assisted-run skill |
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
| `verify_criteria` | — | **none** (same gap as `rex verify`: no requirements/traceability page) |
| `reorganize` | Reorganize panel | full |
| `health` | Health gauge | full |
| `facets` | Facet filters (no distribution view) | partial |
| `append_log` | — | n/a (agent write path; execution log has no viewer, see gap list) |
| `sync_with_remote` | Sync triggers | full |
| `get_token_usage` | Token Usage view (utilization only) | partial |
| `get_capabilities` | — | n/a (protocol handshake) |

## Sourcevision MCP tools (10)

| Tool | Equivalent UI | Coverage |
|------|---------------|----------|
| `get_overview` | Overview tab | full |
| `get_next_steps` | Suggestions tab | full |
| `get_zone` | — | **none** — the zone-detail view (`views/zones.ts`, 2569 lines) exists but is unreachable (see orphaned surface) |
| `get_findings` | Architecture / Problems / Suggestions tabs | full |
| `get_file_info` | Files tab | full |
| `search_files` | Files tab filters + global search overlay | full |
| `get_imports` | Map tab | full |
| `get_classifications` | Files tab role column | partial (no archetype-classification breakdown) |
| `set_file_archetype` | — | **none** (the only sourcevision *write* tool; no UI to override a file's archetype) |
| `get_route_tree` | Routes tab | full |

---

## Orphaned UI surface — resolved 2026-08-12

Roughly 2,900 lines of built view code were unreachable; both views are now registered (guarded by `tests/unit/viewer/restored-views.test.ts`):

1. **`views/analysis.ts` (`AnalysisView`)** — was never registered after the web-package extraction, leaving POST `/api/rex/analyze`, `/api/rex/proposals*`, and `/api/rex/batch-import` without reachable UI. Now `analysis` (REX → "Analyze & Import").
2. **`views/zones.ts` (`ZonesView`, 2569 lines)** — removed from navigation in PR #189 ("obsolete Zones navigation") before PRs #317/#321 invested in expandable zones and a11y, leaving that feature work invisible. Now `zones` (SourceVision → "Zones" tab).

## Server APIs with no UI consumer

| API surface | Size | Note |
|-------------|------|------|
| `/api/hench/adaptive/*` (`routes-adaptive.ts`) | 873 lines, 10 endpoints | Zero occurrences of "adaptive" in `src/viewer/` — an entire feature with no page |
| `/api/rex/requirements/*` | 575 lines | Requirements CRUD/coverage/traceability; feeds `rex verify` / `verify_criteria` gap |
| `/api/sv/*` (all except `pr-markdown`) | 8 endpoints | Viewer reads `/data/*.json` directly; these serve external/MCP consumers — **document as external API, not a UI gap** |
| `/api/token/{summary,events,by-command,by-period,budget}` | 5 endpoints | Token Usage view uses only `utilization` |
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

5. **Requirements / traceability page** — consume the existing 575-line requirements API; closes `rex verify` + `verify_criteria`.
6. **Adaptive-optimization page** — consume `routes-adaptive.ts`; an entire shipped feature is currently invisible.
7. **`rex fix` action** — "Fix issues" button in the Validation view → new POST `/api/rex/fix`.
8. **`rex reshape` flow** — reshape trigger with diff preview + confirm.
9. **`ndx ci` trigger** — "Run CI check" → structured results panel.
10. **Token usage depth** — wire `by-period` / `by-command` / `budget` endpoints into the Token Usage view (restores `ndx usage --group=…` parity).
11. **Self-heal live view** — phase/iteration display + stop control on top of the existing status endpoint.

### Tier 3 — low impact

12. **`sourcevision export-pdf` control** next to the Export panel.
13. **`set_file_archetype` override UI** in the Files tab (only sourcevision write tool without UI).
14. **Facet distribution view** (MCP `facets` parity).
15. **`ndx auth` status chip** in LLM settings.
16. **`hench validate-tokens` trigger** in the Runs view.
17. **Execution-log viewer** (`.rex/execution-log.jsonl`; `append_log` observability).

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
| `hench record` | Skill-integration plumbing |
| MCP `append_log` (write path), `get_capabilities` | Agent/protocol-facing |
| `/api/sv/*` read endpoints | External/MCP-facing API by design; viewer reads `/data/*.json` |
