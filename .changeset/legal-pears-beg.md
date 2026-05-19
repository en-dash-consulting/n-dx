---
"@n-dx/hench": minor
"@n-dx/core": minor
"@n-dx/rex": minor
"@n-dx/web": minor
---

Rework the PRD context graph, harden the hench run loop, and add LLM auto-failover.

**PRD context graph (web)** — Top-down progressive-disclosure layout with folder-tree
visual style; shape-based nodes for epic/feature/task/subtask; click-through opens the
Rex task detail panel with subtree highlighting. Hierarchy is now driven from
`.rex/prd_tree/` paths.

**Hench run loop** — Per-task attempt tracking, completed tasks excluded from
selection, and the loop advances immediately on success. The `no-plan-mode` rule is
embedded in the agent system prompt; autonomous runs (`--auto` / `--loop` /
`--epic-by-epic`) default to `acceptEdits`. New
`docs/contributing/run-loop-invariants.md`.

**LLM auto-failover** — New `llm.autoFailover` flag with vendor-specific failover
chains; `hench run` restores the original config after a failover attempt. Model
resolution honours top-level `llm.model` → `llm.{vendor}.model` → tier default.

**Rex storage** — PRD tree rewritten to canonical `index.md`-per-folder layout with
single-child compaction and atomic leaf-to-folder promotion for subtasks. Timestamped
snapshots before structural migrations; cross-PRD duplicate detection in `reshape`.

**CLI / DX** — New `ndx tree` command and tree-formatted `rex status`; `ndx self-heal`
gains a pre-execution approval gate with `selfHeal.autoConfirm`. Obfuscated-code commit
blocker added.