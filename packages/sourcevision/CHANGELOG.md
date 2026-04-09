# @n-dx/sourcevision

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/llm-client@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.2.0

## 0.1.9

### Patch Changes

- [#106](https://github.com/en-dash-consulting/n-dx/pull/106) [`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82) Thanks [@ryrykeith](https://github.com/ryrykeith)! - ### SourceVision

  - Go language support: import graph analysis, zone detection, route extraction, archetype classification
  - Multi-language project detection (Go + TypeScript coexistence)
  - Database package detection and Architecture view panel (194 known packages across Go/Node/Python)
  - Handler → Database flow tracing in Architecture view
  - Architecture view layout improvements for long Go module paths

  ### Rex

  - Go module scanner (`go.mod` dependency parsing)
  - Go-aware analysis pipeline integration

  ### Hench

  - Go test runner support
  - Go-specific agent planning prompts
  - Go guard defaults in schema

  ### Web Dashboard

  - Database Layer panel in Architecture view
  - Handler → DB Flows panel with BFS path tracing
  - Bar chart label improvements (wider labels, SVG tooltips, smart truncation)
  - Table cell overflow handling for long package names

  ### LLM Client

  - Schema updates supporting Go language constructs

- [#98](https://github.com/en-dash-consulting/n-dx/pull/98) [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Add `withTransaction` API for safe concurrent PRD writes with file locking
  - Add `level` field to `edit_item` MCP tool for changing item hierarchy levels
  - Fix LLM reshape response parsing with action normalization and lenient fallback
  - Fix `--mode=fast` being ignored when `--accept` is passed to `reorganize`
  - Extract shared archive module for prune/reshape/reorganize
  - Add reorganize archiving (removed items preserved in `.rex/archive.json`)
  - Proactive structure: MCP schema coverage audit test

  ### Hench

  - Show auto-selection reasoning in run header (why task was chosen, skipped counts, unblock potential)
  - Show prior attempt history in task card (retry count, last status)
  - Classify changes in run summary (code/test/docs/config/metadata-only)

  ### Web Dashboard

  - Default to showing all PRD items (fixes blank page for 100% complete projects)
  - Remove redundant StatusFilter, wire status chips to tree visibility
  - Smart collapse: tree starts closed when no active work
  - Hide view-header, promote breadcrumb as page title
  - Show sibling page icons in collapsed sidebar rail
  - Move command buttons (Add, Prune) inline into search row
  - Add filtered-empty state messaging

  ### CLI

  - Surface all package commands through `ndx` (validate, fix, health, report, verify, update, remove, move, reshape, reorganize, prune, next, reset, show)
  - Helpful error when running orchestrator commands on package CLIs
  - Workflow-based `ndx --help` grouping (no package names in primary help)
  - Skip provider prompt on re-init when config exists
  - Unified init status report
  - Branded ASCII art CLI header

  ### Docs

  - New 5-minute quickstart tutorial
  - New troubleshooting guide (7 common issues)
  - Commands reference rewritten by workflow stage

  ### Infrastructure

  - `@n-dx/core` included in release workflow (synced version + auto-publish)
  - `/ndx-reshape` skill for PRD hierarchy restructuring
  - `/ndx-capture` skill updated with automatic parent placement and dependency wiring

- [#109](https://github.com/en-dash-consulting/n-dx/pull/109) [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb) Thanks [@dnaniel](https://github.com/dnaniel)! - ### SourceVision

  - **Zone stability:** Louvain community detection now seeds from previous zone assignments, preserving topology across runs. Files stay in their previous zones unless import structure genuinely shifts.
  - **Zone identity preservation:** Zones with >50% file overlap with a previous zone inherit its ID and name, preventing the LLM from inventing new names each run.
  - **Stability bias:** Synthetic co-zone edges reinforce previous zone membership during Louvain optimization. Configurable weight (default 0.5x median import edge).
  - **Stability reporting:** New `stability` field in zones.json tracks file retention, persisted/new/removed zones, and reassigned files between runs.
  - **Finding category taxonomy:** Findings now carry a `category` field (`structural`, `code`, `documentation`) enabling downstream filtering. LLM prompts request categories; regex heuristic classifies when LLM doesn't provide one.
  - **Finding staleness validation:** Findings referencing deleted/moved files are automatically skipped during `rex recommend`.
  - **Weighted cohesion metrics:** Project-wide averages weighted by zone file count. Zones with <5 files excluded from aggregates (unreliable metrics). Both weighted and unweighted averages reported.
  - **Small-zone merge logging:** Configurable merge threshold with debuggability logging.
  - **Git SHA refresh:** `manifest.gitSha` now updated at analysis start, not just init time.

  ### Rex

  - **Self-heal: exclude structural findings:** `--exclude-structural` flag on `rex recommend` skips zone boundary opinions. Self-heal loop passes it by default.
  - **Self-heal: file-level regression guard:** Progress signals shifted from zone-relative (weighted cohesion) to zone-independent metrics (circular deps, code findings, unused exports).
  - **Zone pin discoverability:** `ndx analyze` suggests zone pins when structural findings detected. `ndx config --help` documents `sourcevision.zones.pins`. `rex recommend` shows pin tip for structural findings.
  - **Workflow split:** Base n-dx workflow in `n-dx_workflow.md` (always updated on init) + user customizations in `workflow.md` (preserved across re-init). Prohibited changes section prevents lint-suppress-only commits.
  - **Stats fix:** Childless features now counted in `get_prd_status` totals.
  - **Config routing:** `sourcevision.*` config keys now route to `.n-dx.json` for zone pin management.

  ### Web Dashboard

  - Zone slideout shows "pinned" badge on files with zone pin overrides.
  - Server augments `/api/sv/zones` response with zone pins from `.n-dx.json`.

  ### CLI

  - Fix release workflow: use bash wrapper script for changeset version command (changesets/action splits on whitespace without a shell).

- [#99](https://github.com/en-dash-consulting/n-dx/pull/99) [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Proactive PRD structure health checks with configurable thresholds
  - Post-write health warnings on `rex add` and `rex analyze`
  - Structure health gate in `ndx ci` (fails below score 50)

  ### Web Dashboard

  - Checkbox multi-select: hover reveals checkbox, click row opens detail panel
  - Remove Edit icon from tree rows (detail panel handles editing)
  - Completion timeline view with date range filters (today/week/month/all)

  ### CLI

  - Fix release workflow: use `npx` for changeset commands (pnpm script resolution bug)

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/llm-client@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.1.8
