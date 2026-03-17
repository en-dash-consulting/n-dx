# PRD Steward Vision

Rex today is a PRD tracker — it stores items, validates structure, and surfaces next tasks. The goal is to evolve it into a **PRD steward**: an intelligent curator that actively maintains, reorganizes, and improves the requirements document as the project evolves.

---

## The Problem

PRDs degrade over time. Items get added piecemeal from different sources (manual, analyze, recommend), resulting in:

- **Flat soup**: features dumped at root instead of grouped under meaningful epics
- **Stale structure**: epics that made sense at project start no longer reflect the actual architecture
- **Duplicate drift**: similar items scattered across different epics with overlapping scope
- **Wrong granularity**: some "tasks" are really epics, some "epics" contain a single task
- **Single-axis organization**: hierarchy forces one grouping, but items often belong to multiple concerns (a task can be both "auth" and "API" and "v2 migration")

The user ends up with a document that's technically valid but structurally unhelpful — they can't see the forest for the trees.

---

## Design Principles

1. **Suggest, don't mandate** — the steward proposes reorganizations; the user accepts, modifies, or rejects. Never mutate without consent.
2. **Incremental, not revolutionary** — small targeted improvements (merge these 2 items, move this feature) rather than "here's a completely new structure."
3. **Two axes of organization** — vertical hierarchy (depth) for decomposition, horizontal facets (tags/labels) for cross-cutting concerns.
4. **Continuous quality** — structure quality is monitored and surfaced, not just checked on demand.

---

## Core Capabilities

### 1. Reorganize ("Magic Wand")

A single action — available as a CLI command (`rex reorganize`) and a UI button — that analyzes the current PRD structure and proposes improvements.

**What it detects:**

| Signal | Source | Action |
|--------|--------|--------|
| Orphaned features at root | `structural.ts` (exists) | Propose reparenting under best-matching epic via `epic-correlation.ts` |
| Near-duplicate items | `dedupe.ts` similarity scoring (exists) | Propose merge via `merge.ts` |
| Empty containers | `structural.ts` (exists) | Propose deletion or demotion |
| Oversized epics (>15 tasks) | New heuristic | Propose splitting into sub-epics |
| Undersized epics (1-2 items) | New heuristic | Propose merging with related epic |
| Wrong-level items | Heuristic + LLM | Propose level change (e.g. a "task" that's really a feature) |
| Missing groupings | LLM analysis | Propose new container for related ungrouped items |
| Stale completed subtrees | `prune.ts` (exists) | Propose pruning |

**Output**: a `ReorganizationPlan` — an ordered list of atomic operations (merge, move, split, create, delete) with explanations. Each operation is individually accept/reject-able.

**LLM role**: structural heuristics catch the obvious cases. An optional LLM pass reviews the full tree and suggests semantic groupings that heuristics miss — e.g., "these 4 tasks across 3 features all relate to authentication; consider grouping them."

### 2. Faceted Classification (Horizontal Taxonomy)

The hierarchy is vertical — one parent per item. But real requirements have multiple dimensions:

- **Component**: auth, API, database, UI, CLI
- **Concern**: security, performance, DX, testing
- **Phase**: v1, v2, migration, tech-debt
- **Risk**: high-risk, well-understood, needs-research

These are **facets** — orthogonal to the hierarchy. An item lives under one epic but can be tagged with multiple facets.

**Design:**

Facets build on the existing `tags` field but add structure:

```jsonc
// .n-dx.json or .rex/config.json
{
  "rex": {
    "facets": {
      "component": {
        "label": "Component",
        "values": ["auth", "api", "database", "ui", "cli"],
        "color": "blue"
      },
      "concern": {
        "label": "Concern",
        "values": ["security", "performance", "dx", "testing"],
        "color": "green"
      }
    }
  }
}
```

On items, facets are stored as prefixed tags: `component:auth`, `concern:security`. This is backward-compatible — existing plain tags continue to work. The facet config just adds validation and UI affordances (filters, grouping views, color coding).

**Auto-classification**: when new items are added, the steward can suggest facet values based on title/description keywords and the item's position in the tree. E.g., a task under the "Authentication" epic with "token" in the title auto-suggests `component:auth`.

### 3. Structure Quality Score

A continuously computed health metric for the PRD, surfaced in `rex status` and the web dashboard:

| Dimension | What it measures | Score range |
|-----------|-----------------|-------------|
| **Hierarchy depth** | Items are at appropriate depth (not too flat, not too deep) | 0-100 |
| **Grouping cohesion** | Siblings are semantically related (title/tag similarity within group) | 0-100 |
| **Coverage balance** | No epic is >40% of all work items; no epic has <2 items | 0-100 |
| **Granularity consistency** | Leaf items are similar scope (not mixing "fix typo" with "redesign auth") | 0-100 |
| **Facet coverage** | What percentage of items have facet classifications | 0-100 |
| **Staleness** | Ratio of stale/stuck items to total | 0-100 |

**Composite score**: weighted average, shown as a single number with drill-down. The magic wand targets the lowest-scoring dimensions first.

### 4. Living Document Management

The steward maintains the PRD as a living document:

- **Post-completion review**: when a subtree is fully completed, propose pruning or archiving (today's prune is manual-only).
- **Scope creep detection**: when an epic's task count grows beyond a threshold after initial planning, surface a warning.
- **Stale item nudges**: items in `pending` for >2 weeks with no blocking dependencies get flagged for review (defer, remove, or reprioritize).
- **Periodic re-analysis**: after significant code changes (detected via sourcevision), suggest new items or mark existing ones as potentially addressed.

### 5. Smart Grouping Suggestions

When the user adds items (via `rex add`, smart-add, or recommend), the steward doesn't just check for duplicates — it suggests where the item belongs:

- **Parent suggestion**: "This looks like it belongs under Epic 'Authentication' > Feature 'Token Management'" (uses epic-correlation scoring, extended to all levels)
- **Sibling suggestion**: "3 similar items exist under Feature X — consider grouping with them"
- **New container suggestion**: "You have 4 ungrouped auth-related tasks — create a 'Token Security' feature to hold them?"

---

## UI Interactions

### Magic Wand Button

In the web dashboard, a wand icon in the toolbar. Click it to:

1. Run reorganization analysis (few seconds)
2. Show a proposal panel with grouped suggestions:
   - "Merge: 'Fix auth bug' + 'Patch auth vulnerability' → 'Fix auth vulnerability'"
   - "Move: 'Add rate limiting' from root → under Epic 'API Infrastructure'"
   - "Split: Epic 'Backend' (23 items) → 'API Layer' + 'Data Layer'"
3. Each suggestion has accept/reject/modify controls
4. Accept-all for low-risk suggestions (moves, prunes)
5. Preview mode: see the tree with proposed changes highlighted before committing

### Facet Views

Toggle between hierarchy view (current tree) and facet views:
- **By component**: flat list grouped by component facet
- **By concern**: items grouped by security/performance/etc.
- **Kanban by status**: columns for pending/in-progress/completed, rows by epic
- **Heat map**: matrix of component x concern showing item density

### Structure Health Dashboard

A card in the dashboard showing:
- Overall health score with trend arrow
- Top 3 improvement suggestions (clickable → magic wand proposals)
- Facet coverage visualization

---

## Existing Building Blocks

These already exist and can be composed into steward features:

| Building block | Location | Reuse for |
|---------------|----------|-----------|
| `similarity()` scoring | `analyze/dedupe.ts` | Duplicate detection in reorganize |
| `correlateEpiclessFeatures()` | `core/epic-correlation.ts` | Parent suggestions |
| `validateStructure()` | `core/structural.ts` | Health checks, empty containers |
| `mergeItems()` | `core/merge.ts` | Merge proposals |
| `moveItem()` | `core/move.ts` | Reparenting proposals |
| `pruneItems()` | `core/prune.ts` | Completed subtree cleanup |
| `applyReshape()` | `core/reshape.ts` | Merge/update/reparent/split/obsolete |
| `computeEpicStats()` | `core/analytics.ts` | Balance metrics |
| Recommendation flow | `recommend/*.ts` | Proposal acceptance pattern |
| Tags field | `schema/v1.ts` | Facet storage |

---

## Non-Goals

- **Auto-commit changes**: the steward suggests, never acts unilaterally
- **Replace human judgment**: users decide the right grouping, not the AI
- **Full project management**: Rex is a requirements tool, not Jira — no sprints, no velocity, no time tracking
- **Prescriptive methodology**: works with any hierarchy labels, any grouping style
