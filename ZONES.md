# Zone Governance

Companion document to `CLAUDE.md` — covers zone promotion, naming conventions, and the zone-pin manifest.

`CLAUDE.md` is generated from `packages/core/assistant-assets/` and ships to every
`ndx init` target, so it carries only the **threshold rule** and the universal
governance rules. n-dx's own measured zone data lives here instead, because this file
is repo-internal and is not templated into downstream projects.

## Current zone inventory

From `ndx analyze --deep .` on `main`, 2026-08-24. **No production zone currently meets
the dual-fragility threshold** (cohesion < 0.5 AND coupling > 0.5); the nearest are
`rex-fix`, `web-composition-layer`, and `chunked`, all with coupling well under 0.5.

| Zone | Package | Files | Cohesion | Coupling |
|------|---------|------:|---------:|---------:|
| `web-viewer` | web | 205 | 0.98 | 0.02 |
| `rex-cli` | rex | 170 | 0.99 | 0.01 |
| `hench` | hench | 109 | 1.00 | 0.00 |
| `sourcevision` | sourcevision | 79 | 1.00 | 0.00 |
| `web-server` | web | 62 | 0.96 | 0.04 |
| `llm-client` | llm-client | 39 | 1.00 | 0.00 |
| `core` | core | 35 | 1.00 | 0.00 |
| `viewer-message-pipeline` | web | 7 | 1.00 | 0.00 |
| `chunked` | rex | 5 | 0.67 | 0.33 |
| `rex-fix` | rex | 4 | 0.57 | 0.43 |
| `web-composition-layer` | web | 4 | 0.65 | 0.35 |

Test-only zones (`tests-unit` 567, `tests-integration` 104, `tests-e2e` 83,
`tests-fixtures` 79, plus smaller ones) are excluded — they carry no production
governance obligation.

### Zone IDs retired since earlier revisions

These IDs appear in older governance text and in git history but not in the current
analysis. Most were **renamed or merged**, not deleted — the directories still exist and
their directory-level policies still apply.

| Old zone ID | Current status |
|-------------|----------------|
| `web-shared` | Directory `packages/web/src/shared/` still exists (5 files); Louvain now absorbs it into `web-viewer`. Policy lives in `packages/web/CLAUDE.md`. |
| `crash` | Directory `packages/web/src/viewer/crash/` still exists with barrel enforcement in `boundary-check.test.ts`. |
| `viewer-ui-hub` | Now reported as `web-composition-layer` (4 files, 0.65 / 0.35). |
| `prd-fix-command` | Now reported as `rex-fix` (4 files, 0.57 / 0.43). |
| `chunked-review` | Now reported as `chunked` (5 files, 0.67 / 0.33). |
| `hench-agent` | Now reported as `hench` (109 files, 1.00 / 0.00). |

**Do not hand-maintain the numbers above.** Re-run `ndx analyze --deep .` and read
`.sourcevision/zones.json`. Note that `.sourcevision/` is gitignored (except
`hints.md`), so these values are a point-in-time snapshot committed for reference.

---

## Zone Promotion Checklist

A zone is **formally governed** when its sub-directory crosses the **5-file reliable-metrics threshold**. Below this threshold, cohesion and coupling values are unreliable because the Louvain algorithm has too few nodes to form stable communities. When a sub-directory crosses this threshold, the following checklist must be completed before the zone is referenced in governance documents:

### Checklist (triggered at > 5 files)

- [ ] **Zone policy entry** — Add the zone to the inventory above, plus a named policy subsection in the owning package's `CLAUDE.md` (`packages/<pkg>/CLAUDE.md`) with zone purpose and any addition rules. Do **not** add measured values to the root `CLAUDE.md` — it is generated and ships downstream.
- [ ] **Zone-pin configuration** — Add explicit zone pins for anchor files in `.n-dx.json` under `sourcevision.zones.pins`. Without pins, Louvain may reassign files across re-analyses, making trend tracking unreliable.
- [ ] **`index.ts` barrel** — If the zone is a physical directory sub-zone, ensure a barrel file exists that exports the public API. This enables barrel import enforcement in `boundary-check.test.ts`.
- [ ] **`.sourcevision/zone-pins.md` entry** — Add all pinned files to the zone-pin manifest with a reason for each pin.
- [ ] **Zone ID naming convention** — Confirm the zone ID follows the package-prefix convention below.

### Anti-patterns that bypass the checklist

- Adding a zone to governance without adding pins → zone ID may silently diverge after re-analysis.
- Adding pins without a governance entry → the policy is invisible to contributors.
- Hand-editing measured metrics into the root `CLAUDE.md` → the assistant-body-drift test fails, and n-dx's internals leak into every `ndx init` target.
- Creating a barrel without updating `boundary-check.test.ts` → barrel enforcement is never activated.

---

## Zone ID Naming Convention

Zone IDs should encode their package to prevent cross-package prefix collisions in zone-filter queries and zone reports.

> ⚠️ **This is a target, not the current state.** Louvain derives IDs from the primary directory, and zone pins in `.n-dx.json` control *membership*, not *naming* — they cannot rename a zone. Most current IDs therefore do not follow the table below. Treat it as the convention to apply when explicitly naming or pinning a zone, and reconcile against the inventory at the top of this file before relying on any prefix.

| Prefix | Package path | Example zone IDs |
|--------|-------------|-----------------|
| `sv-` | `packages/sourcevision/` | `sv-analyzer`, `sv-cli` |
| `rex-` | `packages/rex/` | `rex-cli`, `rex-prd-engine` |
| `hench-` | `packages/hench/` | `hench-agent`, `hench-gateway` |
| `llm-` | `packages/llm-client/` | `llm-adapter` |
| `web-server-` | `packages/web/src/server/` zones | `web-server-gateway` |
| `web-viewer-` | `packages/web/src/viewer/` zones | `web-viewer-hub` |
| `web-sv-` | web zones rendering sourcevision data | `web-sv-view-tests` |
| `web-` | other web package zones | `web-shared`, `web-landing` |

### Known divergences

As of the 2026-08-24 analysis, most production zone IDs do not carry the prefixes above:

| Actual ID | Convention would suggest |
|-----------|--------------------------|
| `sourcevision` | `sv-*` |
| `hench` | `hench-*` |
| `llm-client` | `llm-*` |
| `core` | (no rule — core predates the table) |
| `chunked`, `rex-fix` | `rex-*` (`rex-fix` conforms; `chunked` does not) |
| `web-composition-layer` | `web-viewer-*` |
| `tests-*` | (no rule — test zones are unprefixed by convention) |

Only `rex-cli`, `rex-fix`, `web-server`, and `web-viewer` currently match. Earlier revisions of this file claimed "none — all resolved via zone pins", which was not accurate: pins do not rename zones. Closing these divergences requires either renaming support in sourcevision or accepting the directory-derived IDs and rewriting this convention to match.

---

## Zone-Pin Manifest

All intentionally pinned files are listed in `.sourcevision/zone-pins.md`. The manifest exists because:

1. The `pins` map in `.n-dx.json` has no "reason" field — without documentation, pin intent is invisible.
2. Without a manifest, each re-analysis run requires per-reviewer knowledge of the full insight history to distinguish phantom coupling artifacts from real violations.
3. The manifest is a prerequisite for the zone promotion checklist.

**Location:** The manifest lives in the "Zone-Pin Manifest" section of this file (below). Because `.sourcevision/` is gitignored (all files except `hints.md`), the manifest cannot live there. `ZONES.md` is the canonical home.

**Updating the manifest:** When adding or removing a pin in `.n-dx.json`, update the manifest section below simultaneously. Treat divergence between the two as a governance failure.

### Phantom Coupling Artifact Pins

Files pinned to eliminate phantom cross-zone edges from Louvain misclassification.

**web-server zone** — All route handlers, server utilities, and server-side infrastructure pinned to prevent misclassification into the web-viewer zone (the primary source of phantom web-server↔web-viewer coupling):
- `packages/web/src/server/rex-gateway.ts` → `web-server` — Gateway anchor; misclassification creates phantom server↔viewer coupling
- `packages/web/src/server/domain-gateway.ts` → `web-server` — Same as rex-gateway.ts
- `packages/web/src/server/routes-mcp.ts` → `web-server`
- `packages/web/src/server/routes-token-usage.ts` → `web-server`
- `packages/web/src/server/aggregation-cache.ts` → `web-server`
- `packages/web/src/server/routes-rex/` (all files) → `web-server`
- `packages/web/src/server/routes-{cli-timeout,adaptive,config,data,features,hench,integrations,notion,project,search,sourcevision,static,status,validation,workflow}.ts` → `web-server`
- `packages/web/src/server/{concurrent-execution-metrics,index,port,pr-markdown-refresh-diagnostics,prd-io,process-memory-tracker,search-index,start,types,websocket}.ts` → `web-server`
- `packages/web/tests/helpers/server-route-test-support.ts` → `web-server` — Test helper; keeps server test metrics separate from viewer zone
- `packages/web/tests/unit/server/routes-{hench-execute,sourcevision}.test.ts` → `web-server`

**web-viewer zone** — Viewer infrastructure and viewer-prd-interaction zone containment:
- `packages/web/src/viewer/external.ts` → `web-viewer` — Intra-package gateway anchor
- `packages/web/src/viewer/components/{progressive-loader,guide}.ts` → `web-viewer`
- `packages/web/src/viewer/views/status-filter.ts` → `web-viewer`
- `packages/web/src/viewer/views/{enrichment-thresholds,graph,sourcevision-tabs,token-usage,prd}.ts` → `web-viewer`
- `packages/web/src/viewer/usage/{constants,index}.ts` → `web-viewer`
- `packages/web/src/viewer/views/import-graph/{model,layout}.ts` → `web-viewer`
- `packages/web/src/viewer/components/prd-tree/bulk-actions.ts` → `web-viewer` — viewer-prd-interaction zone containment
- `packages/web/src/viewer/hooks/{use-feature-toggle,use-toast}.ts` → `web-viewer` — contained hooks
- `packages/web/tests/unit/viewer/{accessibility,status-filter}.test.ts` → `web-viewer`

**viewer-message-pipeline zone** — All messaging infrastructure pinned to their own zone:
- `packages/web/src/viewer/messaging/{call-rate-limiter,fetch-pipeline,index,message-coalescer,message-throttle,request-dedup,ws-pipeline}.ts` → `viewer-message-pipeline`

**Other web zones:**
- `packages/web/src/viewer/views/hench-runs.ts` → `web-dashboard`
- `packages/web/src/viewer/hooks/use-polling.ts` → `web-dashboard`
- `packages/web/src/landing/landing.ts` → `web-landing`
- `packages/web/{build,dev}.js`, `packages/web/{package.json,tsconfig.json,vitest.config.ts,*.png}` → `web-package-assets`

**web-sv-view-tests zone** — Tests for viewer tabs rendering sourcevision-derived data. Pinned to prevent `sourcevision-` prefix misclassification:
- `packages/web/tests/unit/viewer/enrichment-thresholds.test.ts` → `web-sv-view-tests`
- `packages/web/tests/unit/viewer/sourcevision-tabs.test.ts` → `web-sv-view-tests`

**web-viewer-search-overlay zone** — Search overlay component and its dedicated test. Pinned to replace the misleading `web-helpers` zone name (which implied a general utility bucket) with a bounded, intent-revealing ID. The component participates in a confirmed zone-level cycle with `web-viewer`; see "Confirmed zone-level cycles" in CLAUDE.md.
- `packages/web/src/viewer/components/search-overlay.ts` → `web-viewer-search-overlay` — sole production file in the zone; anchor for cycle documentation
- `packages/web/tests/unit/viewer/search-overlay.test.ts` → `web-viewer-search-overlay` — dedicated component test
- `packages/web/tests/helpers/preact-test-support.ts` → `web-viewer` — test utility used by multiple viewer tests (tree-view, search-overlay); belongs in viewer zone, not search-overlay satellite

### Architectural Anchor Pins

Files pinned to keep critical modules stable across re-analyses regardless of import topology changes.

- `packages/sourcevision/tests/fixtures/go-project/internal/service/user.go` → `sourcevision` — Overflow community (sourcevision-4); Go fixture file; pinned to base zone because `sv-fixtures` zone never forms naturally (Louvain produces `sourcevision-fixtures` for this path prefix)
- `packages/sourcevision/tests/fixtures/go-project/internal/service/user_test.go` → `sourcevision` — Same reason as above
- `packages/sourcevision/vitest.config.ts` → `sourcevision` — Zero import edges; isolated; path derives zone ID `sourcevision` with no unique sub-segment (all segments after `sourcevision` are either `src` or absent and thus skippable). Was `sourcevision-2` overflow in analyses at SHA 7b8ac4e–d4bf436a.
- `packages/hench/src/tools/test-runner.ts` → `hench-agent` — Overflow community (hench-4); tool file belongs with other hench tools
- `packages/hench/tests/unit/tools/go-test-runner.test.ts` → `hench-agent` — Test for test-runner.ts; follows source file pin
- `packages/hench/tests/unit/tools/test-runner.test.ts` → `hench-agent` — Test for test-runner.ts; follows source file pin
- `packages/rex/tests/helpers/rex-dir-test-support.ts` → `rex-unit` — Overflow community (rex-2); test helper used by rex unit tests
- `packages/rex/tests/unit/cli/commands/next-colors.test.ts` → `rex-unit` — Overflow community (rex-2); unit test for CLI color output
- `packages/rex/tests/unit/cli/commands/usage.test.ts` → `rex-unit` — Overflow community (rex-2); unit test for CLI usage command
- `packages/hench/src/prd/rex-gateway.ts` → `hench-gateway` — Cross-package gateway; prevents hench-agent misclassification
- `packages/rex/src/core/{fix,keywords,verify,tree}.ts` → `rex-prd-engine` — Domain logic; must not drift into rex-cli
- `packages/rex/src/analyze/batch-types.ts` → `rex-prd-engine`
- `packages/rex/src/schema/{index,v1,levels}.ts` → `rex-prd-engine`
- `packages/rex/src/cli/commands/fix.ts` → `rex-prd-engine` — Logic-heavy; belongs with domain not CLI zone
- `packages/rex/tests/unit/core/{fix,keywords,verify}.test.ts` → `rex-prd-engine`
- `packages/rex/tests/unit/cli/commands/fix.test.ts` → `rex-prd-engine`
- `packages/rex/vitest.config.ts` → `rex-prd-engine`
- `packages/rex/tests/e2e/{cli-quiet,cli-recommend,cli-smart-add,cli-sync,cli-workflow}.test.ts` → `rex-cli-e2e`
- `packages/rex/tests/e2e/fixtures/sample-prd/.rex/execution-log.jsonl` → `rex-cli-e2e`

### Pending Pins (identified but not yet applied)

| File | Recommended zone | Reason |
|------|-----------------|--------|
| `packages/web/src/shared/index.ts` | `web-server` | Phantom web-server↔web-viewer coupling driver |
| `packages/web/src/viewer/crash/view-id.ts` (if exists) | `web-viewer` | Phantom viewer-crash-recovery↔web-viewer coupling |
| `packages/web/src/server/task-usage/shared-types.ts` (if exists) | `web-server` | Phantom task-usage-scheduler↔web-server coupling |

---

## Phantom Coupling Artifacts

Zone coupling reports can contain **phantom coupling artifacts** — bidirectional pairs reported identically alongside genuine cycles, providing no triage signal for reviewers. A phantom artifact arises when the Louvain algorithm misclassifies a file into the wrong zone, creating import edges that do not reflect real architectural coupling.

**Confirmed artifacts in the web package** (as of last analysis):

| Pair | Artifact-driving file | Resolution |
|------|--------------------|-----------|
| `web-server` ↔ `web-viewer` | `shared/index.ts`, `routes-rex-analysis.ts` | Zone-pin both files to `web-server` |
| `viewer-crash-recovery` ↔ `web-viewer` | `view-id.ts` | Zone-pin to `web-viewer` |
| `task-usage-scheduler` ↔ `web-server` | `shared-types.ts` | Zone-pin to `web-server` |
| `prd-tree-search` ↔ `web-viewer` | `use-facet-state.ts` | Remove from `hooks/index.ts` barrel |

**Genuine cycle** (not an artifact):

| Pair | Nature | Resolution path |
|------|--------|----------------|
| `web-viewer-search-overlay` ↔ `web-viewer` | Real bidirectional coupling — `search-overlay.ts` imports `getLevelEmoji` (runtime) and `NavigateTo` (type) from web-viewer; `components/index.ts` imports back | Absorb `search-overlay.ts` into web-viewer (preferred), or inject `getLevelEmoji` as prop and move `NavigateTo` to `web-shared`; moving `levels.ts` alone is insufficient |

**Future tooling:** A `zone-pin confirmed / artifact suppressed` annotation in sourcevision zone metadata (`ZoneSummary.detectionQuality` extended to `"pin-confirmed-artifact"`) would allow governance tooling to distinguish known-artifact pairs from actionable violations automatically. See `packages/sourcevision/src/schema/v1.ts`.

---

## Unresolved Items Pending PRD Tasks

Three issues are fully characterized but not yet tracked as PRD tasks. Each has a known resolution path requiring no further analysis. Create PRD tasks to convert them from insight records into tracked work items with owners.

| Item | Location | Resolution path | Suggested PRD title |
|------|---------|----------------|---------------------|
| `completion-reader.ts` dead code | `packages/hench/src/` (exact path TBD) | Audit callers with grep; remove if zero consumers | "Remove completion-reader.ts dead code" |
| `web-viewer-search-overlay` ↔ `web-viewer` cycle | `packages/web/src/viewer/components/search-overlay.ts` | Absorb `search-overlay.ts` into web-viewer (preferred) or inject `getLevelEmoji` as prop and move `NavigateTo` to `web-shared`; moving `levels.ts` alone is insufficient | "Fix web-viewer-search-overlay↔web-viewer import cycle" |
