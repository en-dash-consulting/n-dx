# Level Refactoring + PRD Steward: Implementation Plan

This plan combines two interrelated efforts:
1. **Level system refactoring** — replace hardcoded epic/feature/task/subtask with configurable depth levels
2. **PRD steward** — intelligent reorganization, faceted classification, and structural quality

They're sequenced so the level refactoring enables the steward's flexibility, and the steward features build on the refactored foundation.

---

## Phase 1: Level System Foundation

**Goal**: Decouple level identity from level labels. All code operates on depth (L1-L4), labels are runtime config.

### 1.1 Define LevelConfig schema

Create `packages/rex/src/schema/levels.ts`:

```typescript
interface LevelConfig {
  /** Internal key, stored in prd.json. e.g. "L1", "L2", "L3", "L4" */
  key: string;
  /** Display label. e.g. "Epic", "Feature", "Task", "Subtask" */
  label: string;
  /** Plural form. e.g. "Epics", "Features" */
  labelPlural: string;
  /** CLI/UI emoji */
  emoji: string;
  /** Depth in the hierarchy (1-based) */
  depth: number;
}

interface LevelSystemConfig {
  levels: LevelConfig[];  // ordered by depth
}
```

Default config matches current behavior:
```typescript
const DEFAULT_LEVELS: LevelSystemConfig = {
  levels: [
    { key: "L1", label: "Epic",    labelPlural: "Epics",    emoji: "📦", depth: 1 },
    { key: "L2", label: "Feature", labelPlural: "Features", emoji: "✨", depth: 2 },
    { key: "L3", label: "Task",    labelPlural: "Tasks",    emoji: "📋", depth: 3 },
    { key: "L4", label: "Subtask", labelPlural: "Subtasks", emoji: "🔹", depth: 4 },
  ],
};
```

Config loaded from `.n-dx.json` → `rex.levels`, falling back to defaults.

**Files**: new `schema/levels.ts`, update `schema/v1.ts`

### 1.2 Create semantic level helpers

Replace all `level === "epic"` / `level === "task" || level === "subtask"` patterns with helper functions. These are the actual semantics the code cares about:

```typescript
// packages/rex/src/schema/levels.ts

function isRootLevel(level: string): boolean       // can exist at tree root
function isWorkItem(level: string): boolean         // leaf-level actionable item (L3, L4)
function isContainerLevel(level: string): boolean   // groups other items (L1, L2)
function isLeafLevel(level: string): boolean        // cannot have children (deepest level)
function getLevelLabel(level: string): string        // "L1" → "Epic"
function getLevelEmoji(level: string): string        // "L1" → "📦"
function getLevelPlural(level: string): string       // "L1" → "Epics"
function getParentLevel(level: string): string|null  // "L2" → "L1"
function getChildLevel(level: string): string|null   // "L1" → "L2"
function getAllLevels(): string[]                     // ["L1", "L2", "L3", "L4"]
function getWorkItemLevels(): string[]               // ["L3", "L4"]
```

These derive answers from `LEVEL_HIERARCHY` and `LevelConfig`, not from string matching.

**Files to update** (replace string comparisons with helpers):

| File | Current pattern | Replace with |
|------|----------------|-------------|
| `rex/src/cli/commands/status.ts:201` | `level === "epic"` | `isRootLevel(level)` |
| `rex/src/cli/commands/remove.ts:73,110` | `level === "epic"` | `isRootLevel(level)` |
| `rex/src/cli/commands/validate-interactive.ts:62` | `level === "epic"` | `isRootLevel(level)` |
| `rex/src/core/analytics.ts:28,60` | `level === "epic"`, `task\|\|subtask` | `isRootLevel()`, `isWorkItem()` |
| `rex/src/core/structural.ts:329` | `level === "feature"` | `depth === 2` or helper |
| `rex/src/core/epic-correlation.ts:236` | `level === "epic"` | `isRootLevel(level)` |
| `rex/src/core/notion-map.ts:603,646` | `level === "epic"` | `isRootLevel(level)` |
| `rex/src/recommend/create-from-recommendations.ts:152` | `level === "subtask"` | `isLeafLevel(level)` |
| `hench/src/cli/commands/run.ts:46,63,139` | `level === "epic"`, `task\|\|subtask` | `isRootLevel()`, `isWorkItem()` |
| `hench/src/agent/planning/brief.ts:45` | `task\|\|subtask` | `isWorkItem()` |
| `sourcevision/src/generators/pr-markdown-template.ts:46,97` | `level === "epic"`, `level === "feature"` | Use depth or helpers |
| `sourcevision/src/cli/commands/prd-epic-resolver.ts:109,122` | `level === "epic"`, `level === "feature"` | Use depth or helpers |
| `sourcevision/src/analyzers/branch-work-classifier.ts:146-163` | `level === "epic"`, `level === "feature"` | Use depth |
| `sourcevision/src/analyzers/completion-reader.ts:335` | `task\|\|subtask` | `isWorkItem()` |
| `web/src/server/routes-rex.ts:1088-2225` | Multiple level checks | Use helpers via gateway |
| `web/src/viewer/components/prd-tree/*.ts` | Multiple level checks | Use helpers |

### 1.3 Consolidate display mappings

Replace all 4+ scattered `LEVEL_ICONS` / `LEVEL_LABELS` mappings with a single source. Each display site calls `getLevelLabel()` / `getLevelEmoji()` from the config.

**Files to consolidate**:
- `rex/src/cli/commands/prune.ts:620-623` (emoji map)
- `rex/src/cli/commands/prune.ts:94` (plural formatting)
- `web/src/viewer/components/search-overlay.ts:92-97`
- `web/src/viewer/components/prd-tree/prune-confirmation.ts:82-93`
- `web/src/viewer/components/prd-tree/task-detail.ts:773-776`

For the web viewer (browser-bundled, can't import rex at runtime), the level config is serialized into the HTML page data or fetched from the MCP/API endpoint.

### 1.4 Update CLI parsing

- `rex/src/cli/index.ts:153` — accept both keys ("L1") and configured labels ("epic") as CLI input
- `rex/src/cli/commands/constants.ts:17` — generate help text from config
- `rex/src/cli/mcp.ts:73` — generate MCP enum from config
- `hench/src/cli/help.ts:45` — update flag names (keep `--epic` as alias?)

### 1.5 Update LLM prompts

The prompt system in `analyze/reason.ts` needs dynamic label injection:

```typescript
// Before (hardcoded)
const PRD_SCHEMA = `"epic": { "title": string }, "features": [...]`;

// After (generated from config)
function buildPrdSchema(config: LevelSystemConfig): string {
  const L1 = config.levels[0].label.toLowerCase();
  const L2 = config.levels[1].labelPlural.toLowerCase();
  const L3 = config.levels[2].labelPlural.toLowerCase();
  return `"${L1}": { "title": string }, "${L2}": [{ "title": string, "${L3}": [...] }]`;
}
```

**Files**:
- `rex/src/analyze/reason.ts` — `PRD_SCHEMA`, `FEW_SHOT_EXAMPLE`, `TASK_QUALITY_RULES`, `ANTI_PATTERNS`, all prompt templates
- `rex/src/analyze/propose.ts` — `ProposalEpic`/`ProposalFeature`/`ProposalTask` → generic `ProposalNode` with depth

### 1.6 Migration for existing prd.json

Items stored as `"level": "epic"` need to be read as `"level": "L1"`. Two options:

**Option A (recommended): Alias map.** Keep reading old names, normalize on load:
```typescript
const LEVEL_ALIASES: Record<string, string> = {
  epic: "L1", feature: "L2", task: "L3", subtask: "L4",
};
```
Applied in `store.loadDocument()`. On next save, items are written with new keys. Zero-effort migration for users.

**Option B: Explicit migration command.** `rex migrate` rewrites prd.json. More explicit but requires user action.

### 1.7 Update web viewer type mirror

`web/src/viewer/components/prd-tree/types.ts` — update the `ItemLevel` mirror to use `"L1" | "L2" | "L3" | "L4"`. Update `type-consistency.test.ts` assertions accordingly.

---

## Phase 2: Faceted Classification

**Goal**: Add horizontal taxonomy alongside the vertical hierarchy.

### 2.1 Facet config schema

```typescript
// in .n-dx.json or .rex/config.json
interface FacetConfig {
  label: string;           // "Component", "Concern"
  values: string[];        // ["auth", "api", "database"]
  color?: string;          // UI hint
  required?: boolean;      // steward nudges if missing
}

// rex.facets in config
facets?: Record<string, FacetConfig>;
```

### 2.2 Facet storage

Facets stored as prefixed tags on `PRDItem.tags`:

```jsonc
{
  "tags": ["component:auth", "concern:security", "v2", "needs-design"]
  //       ^^^^ faceted ^^^^   ^^^^ faceted ^^^^  ^^^ plain tags ^^^
}
```

New helpers in `packages/rex/src/core/facets.ts`:
```typescript
function getFacetValue(item: PRDItem, facetKey: string): string | undefined
function setFacetValue(item: PRDItem, facetKey: string, value: string): void
function removeFacet(item: PRDItem, facetKey: string): void
function getItemFacets(item: PRDItem, config: FacetConfig): Record<string, string>
function getItemsByFacet(items: PRDItem[], facetKey: string, value: string): PRDItem[]
```

### 2.3 Auto-classification

When items are created (smart-add, recommend, manual), suggest facet values:
- **Keyword matching**: title/description keywords → facet values (configurable mapping)
- **Inheritance**: inherit parent's facets as defaults
- **LLM-assisted**: optional LLM pass to classify items that keyword matching misses

### 2.4 Facet views (web)

New view modes in the dashboard:
- Group-by-facet: show items grouped by a selected facet instead of hierarchy
- Filter-by-facet: filter the tree view to items matching a facet value
- Facet coverage indicator: visual badge showing which facets are set

### 2.5 MCP + CLI

- `rex update <id> --tag component:auth` (already works via tags)
- `rex status --group-by=component` (new: faceted grouping view)
- MCP tool: `rex_facets` — list facet config, `rex_classify` — suggest facets for item

---

## Phase 3: Reorganize Engine (Magic Wand)

**Goal**: intelligent one-click structural improvement.

### 3.1 Reorganization detector

New `packages/rex/src/core/reorganize.ts`:

```typescript
interface ReorganizationProposal {
  id: string;
  type: "merge" | "move" | "split" | "create_container" | "delete" | "relevel" | "prune";
  description: string;     // human-readable explanation
  confidence: number;      // 0-1, how sure we are
  risk: "low" | "medium" | "high";
  items: string[];          // affected item IDs
  detail: MergeDetail | MoveDetail | SplitDetail | ...;
}

interface ReorganizationPlan {
  proposals: ReorganizationProposal[];
  healthBefore: StructureHealthScore;
  healthAfter: StructureHealthScore;  // projected
}
```

**Detection pipeline** (in order of confidence):

1. **Structural checks** (heuristic, high confidence):
   - Orphaned features → propose move (reuse `correlateEpiclessFeatures()`)
   - Empty containers → propose delete
   - Completed subtrees → propose prune (reuse `findPrunableItems()`)

2. **Similarity checks** (heuristic, medium confidence):
   - Near-duplicate items → propose merge (reuse `similarity()`)
   - Items with same facets in different containers → flag for review

3. **Balance checks** (heuristic, medium confidence):
   - Oversized containers (>15 work items) → propose split
   - Undersized containers (1-2 items) → propose merge with sibling
   - Single-child containers → propose collapse

4. **LLM analysis** (optional, lower confidence):
   - Review full tree structure
   - Suggest semantic groupings not caught by heuristics
   - Suggest level changes (a "task" that reads like a feature)
   - Suggest new containers for ungrouped related items

### 3.2 Reorganization executor

Reuse existing primitives:
- Merge → `mergeItems()` from `core/merge.ts`
- Move → `moveItem()` from `core/move.ts`
- Delete → existing remove logic
- Prune → `pruneItems()` from `core/prune.ts`
- Split → new, but inverse of merge (create new container, move subset of children)
- Create container → `insertChild()` + reparent children
- Relevel → update `item.level`, validate placement

Batch execution with rollback: apply proposals atomically (single `saveDocument()`).

### 3.3 Structure health score

New `packages/rex/src/core/health.ts`:

```typescript
interface StructureHealthScore {
  overall: number;          // 0-100
  dimensions: {
    depth: number;          // are items at appropriate depths?
    cohesion: number;       // are siblings related?
    balance: number;        // are containers roughly equal size?
    granularity: number;    // are leaf items similar scope?
    facetCoverage: number;  // what % of items have facets?
    staleness: number;      // ratio of stale items?
  };
  suggestions: string[];    // top 3 improvement actions
}
```

Computed on `rex status`, cached, updated on mutations.

### 3.4 CLI

```sh
rex reorganize [dir]              # detect + show proposals
rex reorganize --accept [dir]     # accept all low-risk proposals
rex reorganize --accept=1,3 [dir] # accept specific proposals
rex health [dir]                  # show structure health score
```

### 3.5 Web UI

- **Magic wand button** in toolbar → runs reorganize, shows proposal panel
- **Proposal panel**: grouped cards with accept/reject per proposal, accept-all for low-risk
- **Preview mode**: toggle to see tree with proposed changes highlighted (additions green, moves blue, deletions red)
- **Health card** on dashboard: overall score, trend, top suggestions

### 3.6 MCP tools

- `rex_reorganize` — return proposals as JSON
- `rex_health` — return health score
- `rex_apply_reorganization` — apply accepted proposals

---

## Phase 4: Living Document Features

**Goal**: proactive maintenance.

### 4.1 Post-completion review

When `rex update <id> --status=completed` completes an entire subtree, automatically check:
- Is the parent now fully completed? → suggest completing parent
- Are there completed subtrees that can be pruned? → suggest prune

### 4.2 Stale item detection

Extend `structural.ts` stale detection:
- Items `pending` for >14 days with no blockers → "review needed" flag
- Items `in_progress` for >48h (exists) → surface in health score
- Items `blocked` whose blockers are completed → auto-suggest unblocking

### 4.3 Scope creep alerts

Track item count per container over time:
- If a container grows by >50% after initial creation → warning
- Surfaced in health score and status output

### 4.4 Re-analysis integration

After `sourcevision analyze` detects significant code changes:
- Cross-reference changed files with existing task descriptions
- Suggest marking addressed items as completed
- Suggest new items for uncovered changes

---

## Dependency Graph

```
Phase 1 (foundation)
  1.1 LevelConfig schema
  1.2 Semantic helpers ─────────────┐
  1.3 Consolidate display mappings  │
  1.4 CLI parsing updates           │
  1.5 LLM prompt updates            │
  1.6 Migration layer               │
  1.7 Web viewer type mirror        │
                                    ▼
Phase 2 (facets)                Phase 3 (reorganize)
  2.1 Facet config schema         3.1 Detection pipeline
  2.2 Facet storage               3.2 Executor
  2.3 Auto-classification         3.3 Health score
  2.4 Facet views (web)           3.4 CLI
  2.5 MCP + CLI                   3.5 Web UI
          │                       3.6 MCP tools
          │                         │
          └────────┬────────────────┘
                   ▼
              Phase 4 (living doc)
                4.1 Post-completion review
                4.2 Stale item detection
                4.3 Scope creep alerts
                4.4 Re-analysis integration
```

Phase 1 is prerequisite for everything. Phases 2 and 3 are independent of each other and can be parallelized. Phase 4 builds on both.

---

## Scope & Sequencing

| Phase | Effort | Value | Ship independently? |
|-------|--------|-------|-------------------|
| 1.1-1.2 (schema + helpers) | Medium | Unlocks everything | Yes — internal refactor, no UX change |
| 1.3-1.4 (display + CLI) | Small | Cleaner code | Ship with 1.1-1.2 |
| 1.5 (LLM prompts) | Medium | Configurable labels work end-to-end | Yes |
| 1.6 (migration) | Small | Existing projects keep working | Ship with 1.5 |
| 2.1-2.2 (facet storage) | Small | Foundation for horizontal org | Yes |
| 2.3 (auto-classify) | Medium | Reduces manual tagging | Yes |
| 3.1-3.2 (reorganize engine) | Large | Core steward value | Yes |
| 3.3 (health score) | Medium | Continuous quality signal | Yes |
| 3.5 (web UI magic wand) | Medium | Primary UX for steward | Ship with 3.1-3.2 |
| 4.x (living doc) | Small each | Polish | Incremental |

**Recommended order**: 1.1-1.4 → 1.5-1.7 → 3.1-3.3 → 3.4-3.6 → 2.1-2.2 → 2.3-2.5 → 4.x

The reorganize engine (Phase 3) delivers the most visible value. Facets (Phase 2) are important but can follow since existing tags provide a workable interim.
