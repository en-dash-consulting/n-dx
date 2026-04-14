# Zone Governance

Companion document to `CLAUDE.md` — covers zone promotion, naming conventions, and the zone-pin manifest.

## Zone Promotion Checklist

A zone is **formally governed** when its sub-directory crosses the **5-file reliable-metrics threshold**. Below this threshold, cohesion and coupling values are unreliable because the Louvain algorithm has too few nodes to form stable communities. When a sub-directory crosses this threshold, the following checklist must be completed before the zone is referenced in governance documents:

### Checklist (triggered at > 5 files)

- [ ] **CLAUDE.md zone policy entry** — Add a named subsection under "Monorepo-wide zone fragility governance" with current cohesion/coupling values, zone purpose, and any zone-specific addition rules.
- [ ] **Zone-pin configuration** — Add explicit zone pins for anchor files in `.n-dx.json` under `sourcevision.zones.pins`. Without pins, Louvain may reassign files across re-analyses, making trend tracking unreliable.
- [ ] **`index.ts` barrel** — If the zone is a physical directory sub-zone, ensure a barrel file exists that exports the public API. This enables barrel import enforcement in `boundary-check.test.ts`.
- [ ] **`.sourcevision/zone-pins.md` entry** — Add all pinned files to the zone-pin manifest with a reason for each pin.
- [ ] **Zone ID naming convention** — Confirm the zone ID follows the package-prefix convention below.

### Anti-patterns that bypass the checklist

- Adding a zone to CLAUDE.md governance without adding pins → zone ID may silently diverge after re-analysis.
- Adding pins without a CLAUDE.md entry → governance policy is invisible to contributors.
- Creating a barrel without updating `boundary-check.test.ts` → barrel enforcement is never activated.

---

## Zone ID Naming Convention

Zone IDs must encode their package to prevent cross-package prefix collisions in zone-filter queries and zone reports. The Louvain algorithm assigns IDs based on the primary directory; the naming convention is enforced via zone pins in `.n-dx.json`.

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

### Known violations

_(none — all resolved via zone pins in `.n-dx.json`)_

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
- `packages/web/src/viewer/graph/{index,physics,renderer}.ts` → `web-viewer`
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
| rex-2 files (unidentified) | Descriptive zone TBD | Unnamed overflow zone — run `sv zones` to identify |

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

Four issues are fully characterized but not yet tracked as PRD tasks. Each has a known resolution path requiring no further analysis. Create PRD tasks to convert them from insight records into tracked work items with owners.

| Item | Location | Resolution path | Suggested PRD title |
|------|---------|----------------|---------------------|
| `completion-reader.ts` dead code | `packages/hench/src/` (exact path TBD) | Audit callers with grep; remove if zero consumers | "Remove completion-reader.ts dead code" |
| `rex-2` zone naming | `packages/rex/src/` (files unidentified) | Run `sv zones` to identify files; add pins in `.n-dx.json` | "Identify and pin rex-2 zone files" |
| `web-viewer-search-overlay` ↔ `web-viewer` cycle | `packages/web/src/viewer/components/search-overlay.ts` | Absorb `search-overlay.ts` into web-viewer (preferred) or inject `getLevelEmoji` as prop and move `NavigateTo` to `web-shared`; moving `levels.ts` alone is insufficient | "Fix web-viewer-search-overlay↔web-viewer import cycle" |
| `hench-4` genuine bidirectional coupling | `packages/hench/src/` | Identify which coupling is acceptable vs. fixable; document or refactor | "Audit and resolve hench-4 bidirectional coupling" |
