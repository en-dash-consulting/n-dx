/**
 * Centralized gateway for rex runtime imports.
 *
 * Hench needs several rex functions at runtime (tree traversal, task
 * selection, timestamp computation, auto-completion).  Rather than
 * scattering `import … from "@n-dx/rex"` across 9+ files, every runtime
 * import is funnelled through this single module.  This makes the
 * cross-package dependency surface explicit and easy to audit.
 *
 * ## Dependency DAG invariant
 *
 * Hench is the only domain package that imports from another domain
 * package (rex).  This creates a strict one-way dependency:
 *
 * ```
 *   hench → rex → llm-client
 *   hench → llm-client
 *   sourcevision → llm-client
 * ```
 *
 * By concentrating all hench→rex runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (re-exports, not scattered
 *   imports).
 * - The DAG stays **acyclic** — rex never imports from hench.
 * - Future changes to rex's public API need only be updated in this
 *   single file.
 *
 * ## Migration safety
 *
 * This gateway is the sole cross-zone coupling surface for ~160 hench
 * files. To mitigate blast radius from rex API changes:
 *
 * 1. **Contract test** — `tests/unit/prd/rex-gateway.test.ts` verifies
 *    every re-export exists and is callable, catching API drift at test
 *    time rather than in production agent loops.
 *
 * 2. **Domain-aligned sections** — re-exports are grouped by concern
 *    (store, tree, task-selection, validation, etc.). If rex ever splits
 *    into sub-packages, each section can be migrated independently.
 *
 * 3. **Narrow consumer surface** — only 3 files import from this
 *    gateway (cli/commands/run.ts, agent/planning/brief.ts,
 *    tools/rex.ts). Each imports only the subset it needs.
 *
 * ## Maximum-scope policy
 *
 * This gateway intentionally limits its surface to the rex APIs that
 * hench needs for its core mission: picking a task, running an agent
 * loop, and recording the result. Categories explicitly in-scope and
 * out-of-scope are listed below. New re-exports must fit an in-scope
 * category — if they don't, the feature should be reconsidered or the
 * policy updated with a documented rationale.
 *
 * **In-scope (re-export permitted):**
 * - Schema version contract (read/validate prd.json compatibility)
 * - Store factory (open a PRDStore for reading/writing)
 * - Save file report (takeSaveFileReport — the files the last PRD save(s)
 *   wrote and deleted, so completion commits stage those paths, not the tree)
 * - Tree traversal (findItem, walkTree — locate items in the tree)
 * - Task selection (findNextTask, findActionableTasks, collectCompletedIds,
 *   matchesAssignee — selection's own `--mine` rule, for the non-selection
 *   operations hench also has to scope to it)
 * - v2 work selection (prdLayout, isChangeLayerStore, findNextWorkTask,
 *   findActionableWork, resolveWorkById — what `get_next_task` runs on a v2
 *   tree, so `ndx work` picks the same unit)
 * - v2 agent brief (buildChangeBrief — the selected unit's brief, built from
 *   its change and the product nodes it touches or amends)
 * - v2 completion (completeV2Work — what `update_task_status` runs on a v2
 *   tree: completes the change with its last task and applies it)
 * - Cross-worktree task claims (openClaimsStore, resolveClaimHolder — the
 *   run claims the task it selected so other worktrees pass over it)
 * - Timestamp computation (status change timestamps)
 * - Parent auto-completion (bubble-up completion when children finish)
 * - Parent reset (reopen completed ancestors when a descendant reopens —
 *   the inverse of auto-completion, and the repair for a withdrawn claim)
 * - Requirements validation (verify task acceptance criteria)
 * - Level helpers (isRootLevel, isWorkItem — classify items)
 * - Finding acknowledgment (load/save/acknowledge sourcevision findings)
 * - Saved run settings (validateRunSettings — the task's own `run` block,
 *   validated with the validator every writer gates on, so what `ndx work`
 *   honours cannot drift from what the dashboard and MCP may save)
 * - PRD tree conformance (checkTreeConformance — refuse to start a run whose
 *   completion write would re-slug the whole tree)
 * - Actor identity (resolveActor — resolve the current user's identity for
 *   `ndx work --mine`, the same string rex stamps into `lastModifiedBy`)
 *
 * **Out-of-scope (must NOT be re-exported):**
 * - PRD mutation (insertChild, updateInTree, removeFromTree — hench
 *   mutates via rex MCP tools, not direct tree manipulation)
 * - Analytics & health (computeEpicStats, computeHealthScore — these
 *   serve the dashboard/UI, not the agent loop)
 * - Merge/consolidation (validateMerge, mergeItems — user-facing operations)
 * - Reorganize/reshape (detectReorganizations, applyReshape — LLM-powered
 *   restructuring is an interactive workflow, not an agent concern)
 * - MCP server factory (createRexMcpServer — web-tier concern only)
 * - Domain constants (PRIORITY_ORDER, LEVEL_HIERARCHY — UI display aids)
 *
 * **Type-only** imports (`import type { PRDStore, … }`) must also
 * flow through this gateway to prevent the type-import promotion
 * erosion path — a type import can be promoted to a runtime import
 * during refactoring, silently bypassing the gateway pattern.
 * This is enforced by domain-isolation.test.js.
 *
 * @module hench/prd/rex-gateway
 * @see packages/web/src/server/domain-gateway.ts — web's equivalent gateway
 * @see packages/hench/tests/unit/prd/rex-gateway.test.ts — contract test
 */

// ---- Schema version contract ------------------------------------------------
export { SCHEMA_VERSION, isCompatibleSchema, assertSchemaVersion } from "@n-dx/rex";

// ---- Store factory ----------------------------------------------------------
export { resolveStore } from "@n-dx/rex";

// ---- Folder-tree storage path -----------------------------------------------
export { PRD_CACHE_DIRNAME, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "@n-dx/rex";

// ---- Save file report ---------------------------------------------------------
// What the last PRD save(s) actually wrote and deleted, project-relative.
// Hench's completion and --reset-deferred commits stage exactly these paths
// (plus the tree-meta sidecar) instead of the whole tree — staging
// `.rex/prd_tree/` wholesale once swept a 1,378-file in-flight rename into a
// "task completed" commit. Only rex's serializer knows which files a save
// touched, so the list must come from the store, not from a hench-side scan.
export { takeSaveFileReport } from "@n-dx/rex";

// ---- PRD tree slug conformance ----------------------------------------------
// The pre-run gate. A run writes the PRD when it completes, so starting one
// against a tree this build would re-slug is how a whole-tree rewrite lands in
// a feature branch under a "task completed" commit.
export { checkTreeConformance } from "@n-dx/rex";

// ---- Tree utilities ---------------------------------------------------------
export { findItem, walkTree } from "@n-dx/rex";

// ---- Task selection ---------------------------------------------------------
export {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  explainSelection,
  traversalBlock,
} from "@n-dx/rex";

// ---- v2 work selection --------------------------------------------------------
// On a v2 tree (product/ + changes/) `resolveStore` returns the change-layer
// store, whose document is the change layer projected as v1 items. Selecting
// from that projection with the v1 selector would run Inbox changes and
// ignore change gates, so hench selects with rex's v2 selector instead — the
// entry point `get_next_task` uses on v2 (findNextWorkTask), the ranked list
// behind it (findActionableWork, for the menu and `--mine`), and the explicit
// `--task` resolver (resolveWorkById: id, display id or alias; a change with
// open tasks resolves to one of them, and openChangeTasks names them when none
// can run). `prdLayout` answers "is this tree v2" without reading it, for the
// flags v2 refuses.
export {
  prdLayout,
  isChangeLayerStore,
  findNextWorkTask,
  findActionableWork,
  resolveWorkById,
  openChangeTasks,
} from "@n-dx/rex";

// ---- v2 agent brief -----------------------------------------------------------
// On a v2 tree the brief is the unit's change and the capabilities and
// constraints it touches or amends, not the v1 parent chain over the
// projection. What that brief holds, and what its budget drops first, is rex's
// to decide; a hench-side assembly would be a second definition of it.
export { buildChangeBrief } from "@n-dx/rex";

// ---- v2 completion --------------------------------------------------------------
// On a v2 tree completing a task can complete its change, and a completed
// change applies its amendments to the product layer per `rex.applyOn`, all in
// one transaction. That is rex's completion — the entry point
// `update_task_status` runs on v2 — so hench completes through it rather than
// writing the status and running the v1 ancestor cascade over the projection,
// which completed the change without ever applying it.
export { completeV2Work } from "@n-dx/rex";

// A failure after that completion must not reopen a change it applied: the
// product layer keeps the amendment whatever the task says. Whether a change is
// applied, and which changes enclose a task, are rex's to answer.
export { isAppliedChange, indexTree, enclosingChangeIds } from "@n-dx/rex";

// A completion commit stages an untracked intent file beside a state.yaml it
// wrote only when that file's node has a row there; an operator's draft has
// none. Which file holds which node, and which rows a folder holds, are the
// reader's to say (its `stateRows` option), not a hench-side frontmatter regex.
export { loadPrdModel } from "@n-dx/rex";

// `matchesAssignee` is selection's own `--mine` rule (own field, or inherited
// from any ancestor). Anything hench scopes to `--mine` that is *not* selection
// — the deferred/failing reset offer, the counts behind an empty menu — has to
// use this, not a second comparison written locally. The reset offered by an
// empty `--mine` menu reset every deferred task in the PRD, including other
// people's, because it was scoped by nothing at all.
export { matchesAssignee } from "@n-dx/rex";

// ---- Cross-worktree task claims ---------------------------------------------
export { openClaimsStore, resolveClaimHolder } from "@n-dx/rex";

// ---- Self-heal tag scoping --------------------------------------------------
export { SELF_HEAL_TAG } from "@n-dx/rex";

// ---- Actor identity ----------------------------------------------------------
// `ndx work --mine` resolves the current user the same way rex stamps
// `lastModifiedBy` on every mutation, so the identity string a task is
// assigned under is the same one that matches it — a hench-local copy would
// be a second definition of "who is running this", free to drift from rex's.
export { resolveActor } from "@n-dx/rex";

// ---- Timestamps -------------------------------------------------------------
export { computeTimestampUpdates } from "@n-dx/rex";

// ---- Parent auto-completion -------------------------------------------------
export { findAutoCompletions, reconcileAutoCompletions } from "@n-dx/rex";

// ---- Parent reset -----------------------------------------------------------
// The pure computation only. `cascadeParentReset` is deliberately not
// re-exported: it applies the resets with rex's own "new child added" wording,
// which is the wrong reason when hench withdraws a completion claim.
export { findParentResets } from "@n-dx/rex";

// ---- Requirements validation ------------------------------------------------
export {
  collectRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
} from "@n-dx/rex";

// ---- Level helpers ----------------------------------------------------------
export { isRootLevel, isWorkItem } from "@n-dx/rex";

// ---- Finding acknowledgment -------------------------------------------------
export { loadAcknowledged, saveAcknowledged, acknowledgeFinding } from "@n-dx/rex";

// ---- Saved run settings -----------------------------------------------------
// The `run` block a task carries (`ndx work` honours it; the dashboard and the
// rex MCP tools write it). Validated here with rex's own validator rather than
// a hench-side shape check: a second definition of what a valid block is would
// let `ndx work` silently ignore settings the dashboard had just accepted, or
// act on ones it would refuse.
export { validateRunSettings } from "@n-dx/rex";

// ---- Commit re-pointing -----------------------------------------------------
// Run records store SHAs (`commits[].sha`, `startHead`, the review's
// `repairCommit`) and a stack rebase or a squash merge rewrites every one of
// them. Rex owns the matching rules — on-main, author-date-subject, patch-id,
// trailer-subject, and an optional host lookup — because a change's own
// commits need the same treatment. Reimplementing them here would be a second
// set of rules that could disagree with rex's about which commit a SHA became.
export { repointCommits } from "@n-dx/rex";

// ---- Type re-exports --------------------------------------------------------
// All type imports from rex must flow through this gateway to prevent
// type-import promotion erosion (a type import can be promoted to a
// runtime import during refactoring, silently bypassing the gateway).
export type { PRDStore, PRDItem, ItemStatus, ResolutionType, CommandExecutor, TreeEntry, SelectionExplanation, SelectionReasonCode, ClaimsStore, ClaimHolder, TaskClaim, ClaimHoldReason, SaveFileReport, TraversalBlock, RunSettings, RepointMatch, RepointMiss, RepointResult, RecordedCommitFacts, V2Tree } from "@n-dx/rex";
