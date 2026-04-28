---
id: "b4127ae4-3f1c-4201-82ba-f648a7915037"
level: "task"
title: "LoE-Aware Consolidated Proposal Generation"
status: "completed"
source: "smart-add"
startedAt: "2026-03-03T07:50:01.464Z"
completedAt: "2026-03-03T07:50:01.464Z"
description: "Enhance the rex add proposal pipeline so the LLM produces fewer, larger work packages by default and attaches structured LoE estimates (engineer-weeks, rationale, confidence) to each item. Changes span the proposal Zod schema, the system prompt, post-processing guardrails, and the CLI review display."
---

## Subtask: Redesign proposal schema and LLM prompt to elicit consolidated, LoE-estimated proposals

**ID:** `c277b516-6b48-4d58-8d2b-7254a7d4d0b2`
**Status:** completed
**Priority:** high

Add optional loe (number, engineer-weeks), loeRationale (string), and loeConfidence ('low'|'medium'|'high') fields to the proposal item Zod schema, then revise the rex add system prompt to (a) generate consolidated, sprint-sized work packages (3–7 items for broad input) rather than micro-tasks, and (b) return structured LoE estimates as JSON fields with a worked example. Prompt wording should be isolated in a named constant or template file for independent iteration.

**Acceptance Criteria**

- Proposal item Zod schema includes loe, loeRationale, and loeConfidence as optional fields
- Existing proposals without LoE fields parse without error
- LoE fields round-trip correctly through proposal serialization and PRD item creation
- tsc --noEmit passes with no new type errors after the schema change
- System prompt explicitly instructs the LLM to prefer consolidated proposals; sample outputs for broad input produce 3–7 high-level items rather than 10+ micro-tasks
- Prompt explicitly requests loe, loeRationale, and loeConfidence as structured JSON fields and includes a worked example
- Prompt wording is isolated in a named constant or template file

---

## Subtask: Add post-processing consolidation guard and LoE display to proposal review

**ID:** `c7a696d0-cbb2-4887-bcc6-094ecffa28e8`
**Status:** completed
**Priority:** medium

After the LLM returns proposals, apply a post-processing pass that detects over-granular output (item count exceeds a configurable ceiling, default 10) and triggers a secondary re-consolidation prompt as a safety net. Additionally, update the interactive proposal review CLI to show loe and loeRationale for each item, visually flagging items that exceed the decomposition threshold so reviewers can make informed decisions before accepting.

**Acceptance Criteria**

- Post-processing detects when proposal item count exceeds a configurable ceiling (default: 10 items per input description)
- Over-granular results trigger a secondary LLM consolidation pass using a defined re-prompt template
- Consolidation pass reduces item count to within the ceiling or emits a labeled warning if it cannot
- The ceiling value is configurable via rex config and exposed in ndx config --help
- Proposal review output shows loe value and rationale for each item that carries LoE data
- Items with loe exceeding the configured decomposition threshold are flagged with a visible indicator
- Items without LoE data display cleanly without empty brackets or missing-field noise
- LoE display is consistent between interactive and --yes (non-interactive) modes

---
