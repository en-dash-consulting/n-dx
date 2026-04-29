---
id: "c12a5570-d983-44b5-b112-1aa386de0a50"
level: "task"
title: "LoE Threshold-Driven Proposal Decomposition"
status: "completed"
source: "smart-add"
startedAt: "2026-03-03T07:31:24.963Z"
completedAt: "2026-03-03T07:31:24.963Z"
acceptanceCriteria: []
description: "Implement an automatic decomposition pass that splits proposal items exceeding the LoE threshold into smaller child items. The threshold defaults to 2 engineer-weeks and is user-configurable. Decomposed items are presented inline in the review so users can accept children, keep the original, or skip entirely."
---

## Subtask: Implement configurable LoE threshold and automatic decomposition pass

**ID:** `b91ff0ae-ef1b-43c1-ac8d-500caa1ff61e`
**Status:** completed
**Priority:** high

Introduce an loe.taskThresholdWeeks key (default: 2) into the rex configuration system and wire it through ndx config for reading, setting, and validation. Implement the decomposition pass: after the initial proposal step, identify items whose loe exceeds the threshold and run a secondary LLM call per item to produce child proposals, each with their own LoE estimates. Recursively decompose children that still exceed the threshold up to a configurable depth limit (default: 2 levels).

**Acceptance Criteria**

- ndx config loe.taskThresholdWeeks returns the current value (default: 2)
- ndx config loe.taskThresholdWeeks 3 updates and persists the value to the config file
- Negative or non-numeric values are rejected with a helpful validation error
- The key appears in ndx config --help output with a description and default value
- Items with loe > loe.taskThresholdWeeks trigger the decomposition pass automatically
- Decomposition LLM call produces child items whose individual LoE values fall at or below the threshold
- Each child item carries its own loe, loeRationale, and loeConfidence
- Items already at or below the threshold are not decomposed
- Decomposition depth is capped at a configurable limit (default: 2 levels) to prevent runaway recursion

---

## Subtask: Add decomposition confirmation UI to proposal review workflow

**ID:** `a82072ae-6e96-4960-a58d-a4e73a46ca2b`
**Status:** completed
**Priority:** medium

When decomposition has occurred for a proposal item, present the decomposed children indented beneath their parent during the review step. The user can accept the decomposed version (adds children, discards the parent), keep the original consolidated item, or skip entirely. Non-interactive mode defaults to accepting decomposed items. Output should clearly label which items were auto-decomposed and the LoE value that triggered decomposition.

**Acceptance Criteria**

- Decomposed children are shown indented beneath their parent item in the review output
- Review prompt offers three choices for decomposed items: accept decomposed, keep original, skip
- Choosing 'accept decomposed' adds child items to the PRD and does not add the parent
- Choosing 'keep original' adds the parent item unmodified
- Non-interactive (--yes) mode defaults to accepting the decomposed version
- Review output labels auto-decomposed items with the LoE value that triggered decomposition

---
