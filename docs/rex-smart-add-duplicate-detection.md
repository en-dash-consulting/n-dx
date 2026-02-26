# Rex Smart Add: Duplicate Detection and Resolution

## Overview

Rex smart add generates structured PRD proposals from natural language descriptions using LLM reasoning. Before this feature, if a smart add prompt overlapped with existing PRD items, the system had no mechanism to detect or address the collision. This could result in silent creation of duplicates, scope overlap, or — in some configurations — outright failure when the overlap was significant enough to confuse proposal placement logic.

This document describes the duplicate detection and resolution system introduced to the smart add flow, covering architecture, user-facing behavior, data model changes, risk analysis, and design rationale.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Similarity Scoring Engine](#similarity-scoring-engine)
4. [Duplicate Detection Pipeline](#duplicate-detection-pipeline)
5. [User Resolution Options](#user-resolution-options)
   - [Cancel](#cancel)
   - [Merge](#merge)
   - [Proceed](#proceed)
6. [Schema Additions](#schema-additions)
7. [Risk Analysis](#risk-analysis)
8. [Non-Interactive (`--accept`) Behavior](#non-interactive---accept-behavior)
9. [Relationship to Recommend Conflict Detection](#relationship-to-recommend-conflict-detection)
10. [Test Coverage](#test-coverage)
11. [File Reference](#file-reference)

---

## Problem Statement

The rex smart add command uses LLM reasoning to transform freeform descriptions into hierarchical PRD proposals (epic > feature > task). The LLM has no awareness of the existing PRD state when generating proposals. This created two failure modes:

1. **Silent duplication**: A user describes work that overlaps with an existing PRD item. The system creates a new item with nearly identical title, description, and scope. The PRD now contains two items tracking the same work, diverging status, and conflicting acceptance criteria.

2. **Placement failure**: When proposal scope significantly overlapped with existing items, the LLM-generated hierarchy could conflict with the existing tree structure in ways that made proposal insertion ambiguous or impossible (e.g., creating a new feature that semantically duplicates a feature already attached to a different epic).

Both scenarios degrade PRD integrity over time and violate the principle that the PRD should be the single source of truth for project tracking.

---

## Architecture Overview

The duplicate detection system operates as a post-generation, pre-persistence interception layer:

```
User description
    |
    v
[LLM Proposal Generation]     <- No change to this stage
    |
    v
[Proposal Quality Validation]  <- Existing quality checks
    |
    v
[Duplicate Detection]          <- NEW: Compare proposals against existing PRD
    |
    v
[User Decision Prompt]         <- NEW: Cancel / Merge / Proceed
    |
    v
[PRD Mutation]                 <- Modified: Respects merge targets and override markers
    |
    v
[Execution Log]                <- Modified: Records merge/override audit trail
```

### Key Design Decisions

- **Post-generation detection**: The LLM generates proposals without awareness of duplication. Detection happens after generation against the live PRD tree. This keeps the LLM prompt simple and avoids coupling proposal quality to deduplication heuristics.
- **User-in-the-loop**: All three resolution paths require explicit user choice. The system never silently merges or silently creates duplicates.
- **Marker-based audit trail**: Both merge and proceed paths leave persistent audit records on the affected PRD items, making it possible to trace decisions retroactively.

---

## Similarity Scoring Engine

Duplicate detection is powered by a multi-signal similarity scorer (`packages/rex/src/analyze/dedupe.ts`) that computes a 0.0–1.0 score between two strings.

### Scoring Tiers

1. **Action verb normalization**: Leading verbs like "Add", "Implement", "Fix" are mapped to canonical synonyms and stripped. This prevents "Implement OAuth flow" and "Add OAuth flow" from scoring high purely because of shared structure rather than shared intent.

2. **Character bigram Dice coefficient**: Extracts all 2-character subsequences and computes overlap ratio. Robust to word reordering.

3. **Fuzzy word-level Jaccard**: Word set comparison with prefix matching (e.g., "auth" matches "authentication" at 0.8 credit). Handles abbreviations and truncation.

4. **Substring containment bonus**: If one string fully contains the other, applies a length-ratio-scaled bonus (0.7–1.0).

The final score is `max(bigramScore, wordScore, fullStringScore)`.

### Thresholds

| Context | Threshold | Rationale |
|---------|-----------|-----------|
| Smart add duplicate detection | 0.7 | Balanced: catches meaningful overlap without flagging tangentially related items |
| Smart add secondary gate | titleScore >= 0.62 AND contentScore >= 0.55 | Catches cases where title alone is borderline but combined evidence is strong |
| Recommend conflict detection | 0.7 | Same threshold for consistency across flows |
| Recommend intra-batch dedup | 0.85 | Stricter: template-generated recommendations share structural patterns that inflate scores |
| Scan result deduplication | 0.7 | Pre-proposal dedup within scan results |

---

## Duplicate Detection Pipeline

### Implementation: `smart-add-duplicates.ts`

The detection pipeline operates on the full proposal set against the full PRD tree.

**Step 1: Flatten proposals into nodes**

Each proposal is decomposed into flat `ProposalNode` entries with stable keys:

```
p0:epic          -> "Security Hardening"
p0:feature:0     -> "OAuth Security"
p0:task:0:0      -> "Implement OAuth callback handler"
p0:task:0:1      -> "Rotate OAuth state secret monthly"
```

Keys encode proposal index, level, and position. These keys are used throughout the merge/override flow to correlate proposal nodes with detection results.

**Step 2: Score each node against the PRD tree**

For each flattened node, the system walks the entire PRD tree (`walkTree()`) and scores the node against every existing item:

```typescript
scoreNodeAgainstItem(node, item) -> CandidateScore | null
```

Scoring logic:
- Exact title match (case-insensitive, whitespace-normalized) -> score 1.0, reason `exact_title`
- Title containment (one title is substring of the other, min 5 chars) -> score 0.95, reason `semantic_title`
- Blended similarity: `max(titleScore, titleScore*0.75 + contentScore*0.25, contentScore*0.7)` where content = description + acceptance criteria
- Threshold: blended >= 0.7 OR (titleScore >= 0.62 AND contentScore >= 0.55)

The best-scoring match across all PRD items is selected for each node.

**Step 3: Build match result**

Each node gets a `ProposalDuplicateMatch`:

```typescript
{
  node: ProposalNode,
  duplicate: boolean,
  reason: "exact_title" | "semantic_title" | "content_overlap" | "none",
  score: number,
  matchedItem?: { id, title, level, status }
}
```

**Step 4: Check for any duplicates**

If any match has `duplicate: true`, the user is prompted.

---

## User Resolution Options

### Cancel

**Behavior**: Exit immediately with no PRD mutations.

**What happens to the PRD**: Nothing. No items are created, no existing items are modified, no audit records are written.

**What happens to proposals**: Proposals are cached to `pending-smart-proposals.json` and can be accepted later via `rex add --accept`. The cached proposals retain their duplicate metadata, meaning a future `--accept` attempt will re-trigger the detection gate.

**Risk profile**: Zero risk to PRD integrity. The only cost is the wasted LLM call that generated the proposals.

**When to choose**: When the user realizes their description was too similar to existing work and they want to rethink their approach entirely.

---

### Merge

**Behavior**: For each proposal node that matched an existing PRD item, the existing item is updated with enriched data from the proposal. Non-duplicate nodes are created as new items. No duplicate items are created.

**Merge semantics for each field**:

| Field | Merge Strategy | Rationale |
|-------|---------------|-----------|
| `description` | Longer description wins (proposal or existing) | Richer descriptions are preferred; if identical after normalization, existing is kept |
| `acceptanceCriteria` | Set union (deduplicated) | Criteria from both sources are combined without loss |
| `priority` | Higher priority wins (lower PRIORITY_ORDER rank) | Proposal may carry urgency information the existing item lacks |
| `tags` | Set union (deduplicated) | Tags from both sources are combined |
| `title` | Not merged (existing title is kept) | Title identity is what triggered the match; changing it would be confusing |
| `status` | Not merged (existing status is kept) | The merge does not alter workflow state |

**Audit trail**: A `MergedProposalRecord` is appended to the existing item's `mergedProposals` array:

```typescript
{
  proposalNodeKey: "p0:task:0:0",
  proposalTitle: "Implement OAuth callback handler",
  proposalKind: "task",
  reason: "exact_title",
  score: 1.0,
  mergedAt: "2026-02-25T...",
  source: "smart-add"
}
```

**What happens to non-duplicate nodes**: Created as new items, exactly as if no duplicates were detected. No override markers. No merge records.

**What happens to parent hierarchy for merged nodes**: When a task-level node merges into an existing task, but the proposal's parent epic/feature also matched existing items, those parent nodes are similarly merged. The `mergeTargetsByNodeKey` map tracks which proposal nodes mapped to which existing item IDs. During `acceptProposals`, any node whose key appears in `mergeTargetsByNodeKey` is skipped for creation but its existing target is used as the parent for child nodes. This means:
- If the epic was merged, its existing ID is used as parent for new features
- If a feature was merged, its existing ID is used as parent for new tasks
- This preserves tree structure without creating duplicate containers

**Risk profile**:

| Risk | Severity | Mitigation |
|------|----------|------------|
| Description regression (shorter proposal replaces longer existing) | Low | `mergeDescription` uses longer-wins strategy |
| Priority escalation (proposal upgrades existing item priority) | Low | By design — proposal may carry urgency context. The `mergedProposals` audit record documents the source |
| Acceptance criteria bloat | Medium | Set union grows monotonically. Over many merges, criteria lists may become unwieldy. No automatic pruning exists |
| Tag proliferation | Low | Same set-union growth as criteria, but tags are lightweight |
| Status inconsistency if merging into completed item | Low | Merge does not change status. A completed item with enriched description/criteria is semantically valid — the new criteria document what was already achieved |
| Orphaned non-duplicate children under merged parents | Low | `acceptProposals` uses `mergeTargetsByNodeKey` to route children to the existing parent, preserving hierarchy |

**When to choose**: When the proposal contains genuinely new information (richer descriptions, additional acceptance criteria, higher priority) that should enrich an existing item rather than create a parallel tracking entry.

---

### Proceed

**Behavior**: All proposal items are created, including those flagged as duplicates. Duplicate items receive a `DuplicateOverrideMarker` for audit purposes. Non-duplicate items are created without markers.

**Override marker structure** (persisted on the new item's `overrideMarker` field):

```typescript
{
  type: "duplicate_guard_override",
  reason: "exact_title" | "semantic_title" | "content_overlap",
  reasonRef: "exact_title:task-existing-id",   // stable key for querying
  matchedItemId: "task-existing-id",
  matchedItemTitle: "Implement OAuth callback handler",
  matchedItemLevel: "task",
  matchedItemStatus: "pending",
  createdAt: "2026-02-25T..."
}
```

**What happens to existing items**: Nothing. The matched existing items are not modified. No merge records, no status changes.

**Risk profile**:

| Risk | Severity | Mitigation |
|------|----------|------------|
| Genuine duplication in PRD tree | High | This is the intended behavior. The user explicitly chose to create duplicates. The override marker documents the decision and enables cleanup tooling |
| Status divergence | High | Two items tracking the same work will develop independent status histories. One may be completed while the other stays pending, or both may be worked on simultaneously |
| Agent confusion (hench) | High | Hench picks the next task via `rex next`. If two tasks have nearly identical titles and descriptions, hench may work on the wrong one, or generate duplicate work across runs |
| Scope ambiguity | Medium | Contributors (human or agent) may not know which of two similar items is the "real" one. The override marker helps but requires awareness of the field |
| Report inflation | Medium | `rex status` counts both items. Completion metrics are inflated by duplicate tracking entries |
| Long-term PRD entropy | Medium | Repeated proceed decisions without cleanup will cause the PRD to accumulate redundant items, making it harder to navigate and trust |

**When to choose**: When the user has determined that the similarity is coincidental (e.g., two tasks with similar titles but genuinely different scope), or when they intentionally want to create parallel tracking entries for work that has forked.

---

## Schema Additions

### `DuplicateOverrideMarker` (schema/v1.ts)

Added to `PRDItem.overrideMarker`. Present only on items created via the "proceed" path.

```typescript
interface DuplicateOverrideMarker {
  type: "duplicate_guard_override";
  reason: string;
  reasonRef: string;
  matchedItemId: string;
  matchedItemTitle: string;
  matchedItemLevel: ItemLevel;
  matchedItemStatus: ItemStatus;
  createdAt: string;
}
```

### `MergedProposalRecord` (schema/v1.ts)

Added to `PRDItem.mergedProposals`. Present only on existing items that absorbed proposals via the "merge" path.

```typescript
interface MergedProposalRecord {
  proposalNodeKey: string;
  proposalTitle: string;
  proposalKind: "epic" | "feature" | "task";
  reason: string;
  score: number;
  mergedAt: string;
  source: "smart-add";
}
```

### `DuplicateReasonMetadata` (analyze/propose.ts)

Attached to proposal nodes during detection for display purposes. Not persisted to the PRD.

```typescript
interface DuplicateReasonMetadata {
  type: DuplicateReasonType;
  matchedItem: { id, title, level, status };
  explanation: string;
}

type DuplicateReasonType =
  | "exact_title_match"
  | "semantic_match"
  | "content_overlap_match"
  | "completed_item_match";
```

### `ProposalEpic` type extraction

The previously anonymous `{ title: string; source: string; description?: string }` epic type on `Proposal` is now a named `ProposalEpic` interface with an optional `duplicateReason` field, matching the pattern on `ProposalFeature` and `ProposalTask`.

---

## Risk Analysis

### PRD Corruption Scenarios

**Can duplicate detection corrupt the PRD?**

No path through the duplicate detection system can produce an invalid PRD document:

1. **Cancel**: No writes occur.
2. **Merge**: Uses `store.updateItem()` which performs a shallow merge on an existing, validated item. The merge only touches `description`, `acceptanceCriteria`, `priority`, `tags`, and `mergedProposals`. None of these fields can violate schema constraints. The `mergedProposals` field is additive-only.
3. **Proceed**: Uses `store.addItem()` which validates hierarchy placement. The `overrideMarker` field is a new schema field that passes validation. Items are created with fresh UUIDs.

All three paths end with `saveDocument()`, which runs schema validation before writing.

**Can it produce a semantically degraded PRD?**

Yes, primarily through the **proceed** path:
- Redundant items inflate scope metrics
- Parallel items tracking the same work create status divergence
- Hench task selection may be confused by near-identical items

And through the **merge** path to a lesser degree:
- Acceptance criteria lists can grow monotonically without pruning
- Priority escalation is one-directional (can go up, never down via merge)

### False Positive Risk

The 0.7 similarity threshold may flag items as duplicates when they are genuinely distinct. Example: "Add user authentication" vs "Add user authorization" score above 0.7 due to high bigram overlap despite being different concerns.

**Mitigation**: The user prompt gives full visibility into what was matched and why. The user can always choose "proceed" to override false positives.

### False Negative Risk

Items with different phrasing but identical scope may slip through undetected. Example: "Set up CI pipeline" vs "Configure automated testing and deployment" share zero title similarity but describe overlapping work.

**Mitigation**: Content-level comparison (descriptions, acceptance criteria) catches some of these, but the system cannot guarantee semantic equivalence detection. This is a fundamental limitation of string-based similarity.

---

## Non-Interactive (`--accept`) Behavior

When smart add is called with `--accept` (auto-accept proposals without interactive prompt), duplicate detection acts as a **hard gate**:

- If duplicates are detected, the command **refuses to create any items** and prints a warning directing the user to re-run interactively.
- If `--format=json`, it returns a structured response with `duplicateGuard: "blocked_requires_interactive_confirmation"`.
- If no duplicates are detected, the command proceeds normally.

**Rationale**: The three resolution options (cancel/merge/proceed) require user judgment. Silently choosing any default in a non-interactive context would undermine the safety purpose of the feature. This is particularly important for CI/automation pipelines where `--accept` might be used.

---

## Relationship to Recommend Conflict Detection

The `rex recommend` command has a parallel but independently implemented conflict detection system (`packages/rex/src/recommend/conflict-detection.ts`). Key differences:

| Aspect | Smart Add Duplicates | Recommend Conflicts |
|--------|---------------------|-------------------|
| Source | LLM-generated proposals | Sourcevision findings |
| Detection module | `smart-add-duplicates.ts` | `conflict-detection.ts` |
| Resolution model | Interactive prompt (cancel/merge/proceed) | Strategy flag (`--force`, default skip) |
| Similarity engine | Same `similarity()` from `dedupe.ts` | Same `similarity()` from `dedupe.ts` |
| Threshold | 0.7 | 0.7 (existing items), 0.85 (intra-batch) |
| Audit trail | `overrideMarker` / `mergedProposals` | None (skipped items are not recorded) |
| Intra-batch dedup | Not implemented (LLM dedup handles this) | Implemented (template patterns cause false positives) |

Both systems share the same `similarity()` function, ensuring consistent scoring. However, they have different resolution models because the use cases differ: smart add is user-initiated and interactive, while recommend operates on machine-generated findings where a skip-by-default strategy is appropriate.

---

## Test Coverage

| Test File | Coverage |
|-----------|----------|
| `tests/unit/cli/commands/smart-add-duplicates.test.ts` | Scoring, matching, marker building, node flattening, reason metadata |
| `tests/unit/cli/commands/smart-add-merge.test.ts` | Merge field semantics (description, criteria, priority, tags), provenance records |
| `tests/integration/smart-add-duplicate-outcomes.test.ts` | End-to-end integration of all three paths (cancel, merge, proceed) against a seeded PRD |

The integration test suite verifies:
- **Cancel**: PRD item count unchanged, no merge records, no override markers
- **Merge**: Existing item enriched (description, criteria, priority, tags), merge provenance recorded, no duplicate items created, no override markers anywhere
- **Proceed**: Duplicate item created with override marker, existing item unmodified, non-duplicate items have no markers, exactly one override marker in the entire PRD

---

## File Reference

| File | Role |
|------|------|
| `packages/rex/src/cli/commands/smart-add.ts` | Main smart add flow, interactive approval loop, merge application, item creation orchestration |
| `packages/rex/src/cli/commands/smart-add-duplicates.ts` | Proposal-to-PRD matching, score computation, override marker building, duplicate reason metadata |
| `packages/rex/src/analyze/propose.ts` | Proposal types including `ProposalEpic`, `DuplicateReasonMetadata`, `DuplicateReasonType` |
| `packages/rex/src/analyze/dedupe.ts` | Shared similarity scoring engine (bigram, word Jaccard, action verb normalization) |
| `packages/rex/src/schema/v1.ts` | `DuplicateOverrideMarker`, `MergedProposalRecord` type definitions |
| `packages/rex/src/recommend/conflict-detection.ts` | Parallel conflict detection for the recommend flow (shared similarity engine) |
| `packages/rex/src/core/tree.ts` | Tree traversal used by duplicate matching (`walkTree`) |
| `packages/rex/src/store/file-adapter.ts` | Persistence layer (`updateItem`, `addItem`, `saveDocument`) |
