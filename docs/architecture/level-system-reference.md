# Rex Level System Reference

Reference document for the item level hierarchy used across n-dx. Intent: refactor from hardcoded `"epic" | "feature" | "task" | "subtask"` to generic depth levels (L1/L2/L3/L4) with user-configurable labels.

---

## Current Design

Four hardcoded string literals define the item hierarchy:

```
epic        (L1) — root-level container, holds features
  feature   (L2) — grouping of related tasks
    task    (L3) — a single unit of work
      subtask (L4) — subdivision of a task
```

Defined in `packages/rex/src/schema/v1.ts`:

```typescript
type ItemLevel = "epic" | "feature" | "task" | "subtask";

const LEVEL_HIERARCHY: Record<ItemLevel, Array<ItemLevel | null>> = {
  epic:    [null],           // root only
  feature: ["epic"],         // under epic
  task:    ["feature", "epic"], // under feature or epic
  subtask: ["task"],         // under task only
};

const CHILD_LEVEL: Record<ItemLevel, ItemLevel | null> = {
  epic: "feature", feature: "task", task: "subtask", subtask: null,
};
```

These are the **structural rules** — they'd stay the same regardless of labels.

---

## Where Levels Are Referenced

### A. Schema & Type Definitions

| File | What | Notes |
|------|------|-------|
| `rex/src/schema/v1.ts:33` | `ItemLevel` type | Canonical definition |
| `rex/src/schema/v1.ts:286-331` | `LEVEL_HIERARCHY`, `VALID_LEVELS`, `CHILD_LEVEL` | Structural rules |
| `rex/src/schema/v1.ts:342` | `isItemLevel()` type guard | Validation |
| `rex/src/schema/v1.ts:136` | `MergedProposalRecord.proposalKind: "epic" \| "feature" \| "task"` | Proposal provenance |
| `rex/src/schema/validate.ts:17` | `z.enum(["epic", "feature", "task", "subtask"])` | Zod schema |
| `rex/src/schema/validate.ts:20` | `z.enum(["epic", "feature", "task"])` | Proposal node kinds |
| `web/src/viewer/components/prd-tree/types.ts:16` | Mirror of `ItemLevel` | Browser bundle (intentional duplication) |

### B. Hierarchy Enforcement (Structural)

These use `LEVEL_HIERARCHY` / `CHILD_LEVEL` generically — they don't hardcode level names:

| File | Function | What it does |
|------|----------|-------------|
| `rex/src/core/tree.ts:58-68` | `insertChild()` | Validates parent-child level via `LEVEL_HIERARCHY` |
| `rex/src/core/move.ts:71-105` | `moveItem()` | Validates reparenting via `LEVEL_HIERARCHY` |
| `rex/src/cli/validate-input.ts:9-20` | `validateLevel()` | Checks against `VALID_LEVELS` set |
| `rex/src/recommend/create-from-recommendations.ts:113-161` | `validatePlacement()` | Level hierarchy + special-case: `item.level === "subtask"` |

### C. Level-Specific Conditionals

Code that branches on specific level strings — these are the hardest to generalize:

| File | Line(s) | Pattern | Semantic meaning |
|------|---------|---------|-----------------|
| `rex/src/cli/commands/status.ts` | 201 | `level === "epic"` | Show per-epic stats |
| `rex/src/cli/commands/remove.ts` | 73, 110 | `level === "epic"` | Grammar ("an" epic), cascade warnings |
| `rex/src/cli/commands/validate-interactive.ts` | 62 | `level === "epic"` | Filter to root items for validation |
| `rex/src/core/analytics.ts` | 28, 60 | `level === "epic"`, `level === "task" \|\| "subtask"` | Epic-level stats, work-item filtering |
| `rex/src/core/structural.ts` | 329 | `level === "feature"` | Feature-level structural analysis |
| `rex/src/core/epic-correlation.ts` | 236 | `level === "epic"` | Epic correlation analysis |
| `rex/src/core/notion-map.ts` | 603, 646 | `level === "epic"` | Notion database mapping |
| `rex/src/recommend/create-from-recommendations.ts` | 152 | `level === "subtask"` | Subtask can't be root |
| `hench/src/cli/commands/run.ts` | 46, 63, 139 | `level === "epic"`, `level === "task" \|\| "subtask"` | Epic listing, work-item selection |
| `hench/src/agent/planning/brief.ts` | 45 | `level === "task" \|\| "subtask"` | Work-item collection for agent briefs |
| `sourcevision/src/generators/pr-markdown-template.ts` | 46, 97 | `level === "epic"`, `level === "feature"` | PR markdown parent chain lookup |
| `sourcevision/src/cli/commands/prd-epic-resolver.ts` | 109, 122 | `level === "epic"`, `level === "feature"` | Resolve epic from file changes |
| `sourcevision/src/analyzers/branch-work-classifier.ts` | 146-163 | `level === "epic"`, `level === "feature"` | Change significance scoring |
| `sourcevision/src/analyzers/branch-work-collector.ts` | 307 | `level === "epic"` | Epic-level collection |
| `sourcevision/src/analyzers/completion-reader.ts` | 335 | `level === "task" \|\| "subtask"` | Work-item detection |
| `web/src/server/routes-rex.ts` | 1088, 1103, 1127, 2225 | `level === "task" \|\| "subtask"`, `level === "epic"` | Prune operations, epic listing |
| `web/src/viewer/components/prd-tree/prd-tree.ts` | 392 | `level === "task" \|\| "subtask"` | Leaf node rendering |
| `web/src/viewer/components/prd-tree/task-detail.ts` | 837, 1213 | `level === "task" \|\| "subtask"` | Task detail panel display |
| `web/src/viewer/components/prd-tree/compute.ts` | 26 | `level === "task" \|\| "subtask"` | Completion stats |
| `web/src/viewer/components/prd-tree/smart-add-input.ts` | 98-350 | `level === "epic" \|\| "feature"` | Parent picker for smart-add |

**Pattern summary**: Most conditionals fall into two semantic categories:
1. **"Is this a root/container item?"** → checks for `epic` (L1)
2. **"Is this a work item?"** → checks for `task || subtask` (L3/L4)

### D. Display Mappings (Labels, Emoji, Icons)

Four separate emoji/label mappings exist — these should be consolidated:

| File | Lines | Mapping |
|------|-------|---------|
| `rex/src/cli/commands/prune.ts` | 620-623 | `epic→📦 feature→✨ task→📋 subtask→🔹` |
| `web/src/viewer/components/search-overlay.ts` | 92-97 | `epic→🏰 feature→⭐ task→✅ subtask→🔹` |
| `web/src/viewer/components/prd-tree/prune-confirmation.ts` | 82-93 | Labels: `Epic/Feature/Task/Subtask`, Icons: `■/◆/●/○` |
| `web/src/viewer/components/prd-tree/task-detail.ts` | 773-776 | `LEVEL_LABELS` for detail panel |
| `rex/src/cli/commands/prune.ts` | 94-99 | `formatLevelSummary()` — pluralizes: `"2 epics, 3 tasks"` |

### E. LLM Prompt Templates

Level names are baked into prompts sent to LLMs for PRD generation:

| File | Constant | Content |
|------|----------|---------|
| `rex/src/analyze/reason.ts:889-891` | `PRD_SCHEMA` | JSON schema describing `"epic"`, `"features"`, `"tasks"` structure |
| `rex/src/analyze/reason.ts:928-952` | `FEW_SHOT_EXAMPLE` | Example JSON with `epic.title`, `features[].tasks[]` |
| `rex/src/analyze/reason.ts:898-904` | `TASK_QUALITY_RULES` | References "task" in quality guidelines |
| `rex/src/analyze/reason.ts:910-915` | `ANTI_PATTERNS` | References "tasks", "features" |
| `rex/src/analyze/reason.ts:1138` | Prompt text | `"Group related items into epics and features logically"` |

### F. Proposal Structure (Hardcoded 3-tier)

The proposal system uses a fixed `epic → features[] → tasks[]` structure, not the generic `PRDItem` hierarchy:

| File | What |
|------|------|
| `rex/src/analyze/propose.ts:44-54` | `ProposalEpic`, `ProposalFeature`, `ProposalTask` interfaces |
| `rex/src/analyze/propose.ts` | `Proposal = { epic, features[] }` — no subtask tier |
| `rex/src/cli/commands/smart-add.ts` | Converts proposal structure to PRDItems |
| `rex/src/cli/commands/smart-add-duplicates.ts` | Accesses `proposal.features`, `feature.tasks` |

### G. CLI Commands & Help Text

| File | What |
|------|------|
| `rex/src/cli/commands/constants.ts:17` | `"Add item manually (epic\|feature\|task\|subtask)"` |
| `rex/src/cli/index.ts:153` | `new Set(["epic", "feature", "task", "subtask"])` for CLI parsing |
| `rex/src/cli/mcp.ts:73` | MCP tool schema: `z.enum(["epic", "feature", "task", "subtask"])` |
| `hench/src/cli/help.ts:45` | `--epic=<id\|title>` flag documentation |
| `web/src/viewer/components/guide.ts:73` | `"epics → features → tasks → subtasks"` |
| `web/src/viewer/components/faq.ts` | References epics, features, tasks in FAQ content |

### H. Cross-Package Gateway Re-exports

| Gateway | Exports level-related symbols |
|---------|------|
| `hench/src/prd/rex-gateway.ts` | Rex types (ItemLevel, etc.) |
| `web/src/server/rex-gateway.ts` | `LEVEL_HIERARCHY`, `CHILD_LEVEL`, `VALID_LEVELS`, ItemLevel type |

### I. Test Files with Level Logic

These test files contain level-specific assertions that will need updating:

| File | Focus |
|------|-------|
| `rex/tests/unit/core/move.test.ts` | Level hierarchy validation |
| `rex/tests/unit/core/structural.test.ts` | Root/parent placement |
| `rex/tests/unit/cli/validate-input.test.ts` | Level string validation |
| `rex/tests/unit/cli/commands/add.test.ts` | Adding items at each level |
| `rex/tests/unit/core/next-task.test.ts` | Task selection |
| `rex/tests/unit/recommend/create-from-recommendations.test.ts` | Hierarchy validation |
| `rex/tests/unit/recommend/conflict-detection.test.ts` | Conflict detection |
| `web/tests/unit/server/type-consistency.test.ts` | Validates `VALID_LEVELS.size === 4` |
| `web/tests/unit/viewer/add-item-form.test.ts` | Level button interaction |
| `web/tests/unit/viewer/tree-utils-deletion.test.ts` | Hierarchical deletion |

---

## Semantic Roles

Most level-specific code isn't really about "epic" vs "feature" — it's about **depth-based roles**. Two concepts cover nearly all conditionals:

| Concept | Current check | Meaning | Generic equivalent |
|---------|--------------|---------|-------------------|
| **Root container** | `level === "epic"` | Top-level grouping, can be at root | `depth === 1` or `isRootLevel(level)` |
| **Work item** | `level === "task" \|\| level === "subtask"` | Leaf-level actionable item | `isWorkItem(level)` or `isLeafLevel(level)` |
| **Grouping item** | `level === "epic" \|\| level === "feature"` | Containers for work items | `isContainerLevel(level)` |
| **Deepest leaf** | `level === "subtask"` | Cannot have children | `CHILD_LEVEL[level] === null` |

---

## Proposal System (Special Case)

The `analyze/propose.ts` system is the hardest to generalize because it uses a **fixed 3-tier object shape**, not the generic PRDItem tree:

```typescript
interface Proposal {
  epic: { title: string };
  features: Array<{
    title: string;
    tasks: Array<{ title, description, acceptanceCriteria, ... }>;
  }>;
}
```

This is embedded in LLM prompts (`PRD_SCHEMA`, `FEW_SHOT_EXAMPLE`). The LLM returns JSON matching this shape, which is then converted to `PRDItem` objects. Changing this requires updating both the prompt and the response parser simultaneously, plus the few-shot example.

---

## Migration Path

### What stays the same
- `LEVEL_HIERARCHY` rules (structural parent-child relationships)
- `CHILD_LEVEL` mappings
- 4-level max depth
- `PRDItem.level` field in stored documents

### What changes
- `ItemLevel` type: `"epic" | ...` → `"L1" | "L2" | "L3" | "L4"` (internal)
- All display strings: lookup from config instead of hardcoded
- All `level === "epic"` checks: use semantic helpers (`isRootLevel()`, `isWorkItem()`)
- LLM prompts: inject configured labels dynamically
- Proposal structure: generate field names from config
- Existing `.rex/prd.json` files: migration to remap old level strings

### Configuration shape (in `.n-dx.json`)

```jsonc
{
  "rex": {
    "levels": {
      "L1": { "label": "Epic",    "emoji": "📦" },
      "L2": { "label": "Feature", "emoji": "✨" },
      "L3": { "label": "Task",    "emoji": "📋" },
      "L4": { "label": "Subtask", "emoji": "🔹" }
    }
  }
}
```

Defaults match current behavior. Users can override to e.g. `"Theme" / "Story" / "Task" / "Step"` or `"Initiative" / "Epic" / "Story" / "Task"`.
