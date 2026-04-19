# CLI ↔ Dashboard Coverage Gap Inventory

_Last updated: 2026-04-18_

## Methodology

Every ndx CLI command (core + delegated rex / sourcevision / hench sub-commands) is rated:

- **full** — dashboard has a trigger, status view, and configuration panel for this command  
- **partial** — dashboard exposes some but not all meaningful facets (read-only view exists but no trigger, or trigger exists but without config surface)  
- **none** — no dashboard representation at all

"User impact" is rated **high / medium / low** based on how frequently the command appears in a normal daily workflow.

---

## Summary Table

| Command | Coverage | Impact | Notes |
|---------|----------|--------|-------|
| `ndx work` | partial | **high** | Epic-by-epic execution panel exists; direct `hench run` trigger missing |
| `ndx analyze` (sourcevision) | none | **high** | No dashboard trigger to re-run sourcevision analysis after code changes |
| `ndx sync` | none | **high** | Notion config view exists; no trigger to push/pull sync |
| `ndx refresh` | none | **high** | No trigger to refresh sourcevision data + rebuild dashboard artifacts |
| `ndx recommend` | partial | **high** | Suggestions view shows results; no trigger to re-run recommend pass |
| `ndx plan` / `ndx plan --accept` | full | **high** | Analyze-panel + proposal-editor + accept flow fully implemented |
| `ndx add` | full | **high** | Add-item form, inline-add, batch import, smart-add preview all present |
| `ndx status` | full | **high** | Rex dashboard + PRD tree fully implemented |
| `ndx usage` | full | **high** | Token usage view + `/api/usage/*` routes fully implemented |
| `ndx self-heal` | none | medium | No dashboard representation of the iterative improvement loop |
| `ndx ci` | none | medium | CI validation pipeline has no dashboard trigger or results view |
| `ndx export` | none | medium | No trigger to export a static deployable dashboard |
| `rex validate` | partial | medium | Validation results view exists (`/api/validation/*`); no trigger to re-run |
| `rex reshape` | none | medium | LLM-powered PRD restructuring has no dashboard trigger |
| `rex fix` | none | medium | Auto-fix for common PRD issues has no dashboard entry point |
| `rex health` | full | medium | Health gauge + `/api/rex/health` fully implemented |
| `rex reorganize` | full | medium | Reorganize panel + apply route fully implemented |
| `rex prune` | full | medium | Prune confirmation + preview + execute fully implemented |
| `rex verify` | partial | medium | Requirements coverage endpoint exists; no UI panel |
| `rex next` | full | medium | Active-tasks panel + `/api/rex/next` |
| `rex update` | full | medium | Inline status picker + bulk actions |
| `rex remove` | full | medium | PRD tree delete actions |
| `rex move` | full | medium | PRD tree reparent (drag-and-drop / move) |
| `ndx config` | partial | medium | Config view, cli-timeouts, feature-toggles present; cross-package config write not exposed |
| `ndx pair-programming` / `bicker` | none | low | No dashboard representation |
| `rex report` | none | low | JSON health report; health view covers most of this |
| `sourcevision reset` | none | low | Dangerous destructive command; low frequency |
| `hench show` | full | low | Hench-runs view + run details |
| `ndx init` | none | low | One-time setup wizard; not needed post-init |
| `ndx dev` | none | low | Dev-server command; not relevant in dashboard context |
| `ndx start` / `ndx web` | n/a | — | This command IS the dashboard |
| `ndx version` | none | low | CLI diagnostic; not meaningful in dashboard |
| `ndx help` | none | low | Guide + FAQ views provide equivalent UX |

---

## Priority-Ordered Gap List

Gaps ranked by user-facing impact. Items with **none** coverage and **high** impact are the first implementation targets.

### Tier 1 — High impact, no dashboard coverage

#### 1. `ndx analyze` (sourcevision re-run trigger)
After modifying source files, users must drop to the terminal to refresh the analysis. A simple "Re-analyze" button with a progress indicator (streaming stdout) would eliminate the most common terminal escape.

**Suggested UI:** Toolbar button in the Overview / Zones views → POST `/api/sv/analyze` (new route) → stream progress via WebSocket → auto-refresh data views on completion.

#### 2. `ndx sync` (Notion push / pull trigger)
The Notion config view exists but there is no way to trigger a sync from the dashboard. Users with Notion integration must run `ndx sync --push` / `ndx sync --pull` manually.

**Suggested UI:** "Sync" split-button (push / pull / bidirectional) in the Notion config view → POST `/api/notion/sync` → show last-sync timestamp and conflict summary.

#### 3. `ndx refresh` (data + artifact rebuild trigger)
After running `ndx plan --accept` or editing config, the dashboard caches go stale. Restart is needed. A dashboard-initiated refresh avoids the terminal entirely.

**Suggested UI:** "Refresh data" button in settings or top-nav → POST `/api/refresh` → stream phase progress (analyze → build → reload) → auto-reload viewer on completion.

### Tier 2 — High impact, partial dashboard coverage

#### 4. `ndx work` (hench run trigger)
The epic-by-epic execution panel exists and covers a planned execution mode, but there is no equivalent to `ndx work --task=ID` (run a specific task) or `ndx work --auto` (pick next and execute). The hench runs view shows history but provides no start-new-run control.

**Suggested UI:** "Run next task" button in the PRD tree next-task panel + "Run this task" context action on individual task nodes → POST `/api/hench/execute` (route exists) → live log streaming in hench-runs view.

#### 5. `ndx recommend` (re-run trigger)
The suggestions view reads sourcevision recommendations but they are static until `rex recommend` is re-run. Users cannot trigger a fresh recommendation pass from the dashboard.

**Suggested UI:** "Refresh recommendations" button in the Suggestions view → POST `/api/rex/recommend` (new route) → reload suggestions list.

### Tier 3 — Medium impact, no dashboard coverage

#### 6. `ndx self-heal` (iterative improvement loop)
Self-heal chains analyze → recommend → work in a loop with regression detection. It is the primary autonomous improvement workflow. Having no dashboard entry point means users cannot monitor or control it.

**Suggested UI:** Dedicated "Self-Heal" view showing current loop iteration, phase (analyze / recommend / execute), iteration count, and stop control → POST `/api/self-heal/start` / `/api/self-heal/stop`.

#### 7. `ndx ci` (CI validation pipeline)
`ndx ci` runs the full analysis + PRD health validation and is used in automated pipelines. A dashboard "Run CI check" button would let developers validate locally before pushing.

**Suggested UI:** "Run CI check" button in the Validation view → POST `/api/ci/run` → show structured results (findings count, health score, pass/fail).

#### 8. `ndx export` (static dashboard export)
Exporting a read-only snapshot for sharing with stakeholders requires the terminal. 

**Suggested UI:** "Export dashboard" button in settings → POST `/api/export` → download ZIP or open deploy dialog.

#### 9. `rex reshape` (LLM PRD restructuring)
Reshape uses an LLM to reorganize the PRD hierarchy. This is a high-risk operation that benefits from a confirmation flow the dashboard could provide better than the CLI.

**Suggested UI:** "Reshape PRD" action in the PRD view → POST `/api/rex/reshape` → preview diff → confirm apply.

#### 10. `rex fix` (auto-fix PRD issues)
After validation surfaces issues, `rex fix` resolves them automatically. The validation view shows problems but offers no fix action.

**Suggested UI:** "Fix issues" button in the Validation view → POST `/api/rex/fix` → re-load validation results.

### Tier 4 — Medium impact, partial coverage gaps

#### 11. `rex validate` (trigger)
The validation view shows results but they are read-only snapshots. Users cannot trigger a fresh validation run from the dashboard.

**Suggested UI:** "Re-validate" button in the Validation view → POST `/api/validation/run` (new route).

#### 12. `rex verify` (acceptance criteria → test mapping)
The `/api/rex/requirements/coverage` endpoint exists but there is no UI panel exposing the traceability matrix or verify results.

**Suggested UI:** "Requirements" tab in the PRD view or a dedicated view showing the coverage matrix with pass/fail status per acceptance criterion.

#### 13. `ndx config` (cross-package write)
The config view lets users see and change most settings, but writing cross-package config (e.g., switching LLM vendor across all packages atomically) is not exposed.

**Suggested UI:** Extend the existing config view with a structured form for `.n-dx.json` top-level keys (llm.vendor, llm.claude.model, web.port).

---

## Commands with N/A or Intentional No-Dashboard Status

| Command | Rationale |
|---------|-----------|
| `ndx start` / `ndx web` | This command launches the dashboard; not representable within it |
| `ndx dev` | Dev-server tooling; not relevant to production dashboard users |
| `ndx init` | One-time setup; a post-init onboarding checklist could replace it |
| `ndx version` | CLI diagnostic; package version in footer is sufficient |
| `ndx help` | Guide + FAQ views cover this |
| `sourcevision reset` | Destructive; low frequency; intentionally terminal-only |
| `ndx pair-programming` / `bicker` | Experimental; cross-vendor review not yet a dashboard workflow |
| `rex report` | JSON output for CI pipelines; health view covers the interactive use case |

---

## Implementation Order Summary

| Priority | Command(s) | Effort est. |
|----------|-----------|------------|
| P1 | `ndx analyze` trigger | S — one new route + button + WS progress |
| P1 | `ndx sync` trigger | S — reuse existing Notion gateway, add route |
| P1 | `ndx refresh` trigger | M — multi-phase progress streaming |
| P2 | `ndx work` run-task trigger | M — reuse `/api/hench/execute`, add PRD context actions |
| P2 | `ndx recommend` trigger | S — one new route + button in suggestions view |
| P3 | `ndx self-heal` view | L — new view + start/stop control + live phase display |
| P3 | `ndx ci` trigger | M — new route + structured results panel |
| P3 | `ndx export` trigger | M — new route + download/deploy flow |
| P3 | `rex reshape` action | M — new route + diff preview + confirmation |
| P3 | `rex fix` action | S — one new route + button in validation view |
| P4 | `rex validate` trigger | S — one new route + button |
| P4 | `rex verify` panel | M — new requirements traceability view |
| P4 | `ndx config` cross-package write | S — extend existing config form |
