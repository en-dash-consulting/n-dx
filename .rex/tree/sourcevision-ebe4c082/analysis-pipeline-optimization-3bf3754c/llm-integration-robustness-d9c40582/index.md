---
id: "d9c40582-36ed-4426-862a-5dad0a402e3c"
level: "task"
title: "LLM Integration Robustness"
status: "completed"
source: "llm"
startedAt: "2026-02-08T16:27:52.564Z"
completedAt: "2026-02-08T16:27:52.564Z"
acceptanceCriteria:
  - "Meta-evaluation does not generate critical-severity refactoring suggestions based on false-positive upstream findings"
  - "Findings corrected in features 1-3 no longer produce amplified LLM recommendations"
description: "Improve reliability of AI-powered analysis\n\n---\n\nThe pass 5+ meta-evaluation in enrich-batch.ts:52-130 sends all findings to Claude for severity reassessment and meta-pattern detection. When it receives false-positive findings (inflated god function counts, phantom unused exports), it amplifies them into critical-severity recommendations like \"decompose CallGraphView\" and \"systematic dead export accumulation.\" The LLM output is only as good as its input."
---

## Subtask: Enhance JSON extraction and repair

**ID:** `53825594-2a47-4a28-9cfd-b41960d92b3d`
**Status:** completed
**Priority:** high

Improve extractJson and repairTruncatedJson functions

**Acceptance Criteria**

- Truncated JSON responses are repaired correctly
- Invalid JSON is handled gracefully
- Retry logic works for parsing failures

---

## Subtask: Optimize scan result chunking

**ID:** `b152ce55-8c25-45a7-b712-6d7fa9c1203e`
**Status:** completed
**Priority:** medium

Improve chunkScanResults for large analysis jobs

**Acceptance Criteria**

- Large codebases are chunked appropriately
- Context is preserved across chunks
- Memory usage is optimized

---

## Subtask: Implement robust LLM response parsing

**ID:** `8d448bbb-3a2e-43e6-b7a9-2acc8fa44b38`
**Status:** completed
**Priority:** high

Parse LLM responses with fallback mechanisms for malformed content

**Acceptance Criteria**

- parses a single-epic response with features and tasks
- handles malformed LLM response gracefully by returning ready
- handles AI response wrapped in markdown fences
- includes previous exchanges in the prompt
- includes project context in the prompt when provided
- includes few-shot example in the prompt

---

## Subtask: Enhance proposal building logic

**ID:** `a25d13dc-417e-4020-939c-0a350f5e98de`
**Status:** completed
**Priority:** medium

Improve how scan results are organized into structured proposals

**Acceptance Criteria**

- groups results by epic inferred from tags
- deduplicates results with same name and kind
- prioritizes by priority (critical first)
- places tasks under features from same sourceFile
- handles explicit epics from scan results
- creates implicit features for orphan tasks

---

## Subtask: Handle large result sets with chunking

**ID:** `34bf31c6-1226-4d0e-8307-552724f1f123`
**Status:** completed
**Priority:** high

If scan results exceed 100 items, batch into multiple LLM calls

**Acceptance Criteria**

- Automatic chunking for large result sets
- Context preservation across chunks
- Proper merging of chunked results

---

## Subtask: Handle deeply nested tree truncation recovery

**ID:** `fe192dc5-cd62-4d2d-ab26-370285dfd5e7`
**Status:** completed
**Priority:** medium

Implement recovery logic for deeply nested trees (4+ levels) when JSON is truncated

**Acceptance Criteria**

- handles deeply nested truncation
- handles deeply nested trees (4 levels)

---

## Subtask: Implement robust JSON truncation recovery

**ID:** `e72afed7-a785-4716-958a-d8d6eaaef79d`
**Status:** completed
**Priority:** high

Handle various JSON truncation scenarios including mid-key truncation and partial data

**Acceptance Criteria**

- handles truncation in the middle of a key name
- recovers from truncated JSON
- handles deeply truncated JSON with partial acceptance criteria
- handles JSON with trailing commas from truncation

---

## Subtask: Enhance LLM response parsing with prose handling

**ID:** `a5547b5c-f1e1-491c-8193-a3280771cbf8`
**Status:** completed
**Priority:** high

All acceptance criteria already met by existing implementation and 109 tests. No code changes needed.

**Acceptance Criteria**

- strips leading prose from LLM response
- extracts JSON object wrapped in prose and treats as single-item array
- throws descriptive error when nothing is salvageable
- provides useful error message for non-JSON

---

## Subtask: Handle escaped characters in JSON strings

**ID:** `2d88295f-93ac-44ac-aab4-1e94ada32bcb`
**Status:** completed
**Priority:** medium

Process escaped characters correctly in JSON parsing

**Acceptance Criteria**

- handles single-character strings
- handles escaped characters inside strings

---

## Subtask: Improve project context reading

**ID:** `9a6d5e8e-c1c7-46ff-9d6f-976b8dbee8b9`
**Status:** completed
**Priority:** medium

Better processing of project documentation files

**Acceptance Criteria**

- reads CLAUDE.md when present
- reads both CLAUDE.md and README.md
- skips empty files
- truncates content exceeding max length
- stops reading files once budget is exhausted
- reads plain README file

---

## Subtask: Filter false-positive findings before LLM meta-evaluation

**ID:** `9937726f-a53d-47e8-aee1-6321f8e18827`
**Status:** completed
**Priority:** medium

In enrich-batch.ts:52-130, runMetaEvaluation() sends all findings to Claude for severity reassessment. Once features 1-3 fix the upstream false positives, the LLM input will improve automatically. However, as a defense-in-depth measure, add a confidence/reliability annotation to findings so the meta-evaluator can weight them appropriately. Specifically: (1) in buildMetaPrompt() (enrich-config.ts:109-161), annotate each finding with its source pass and detection method, (2) instruct the LLM to not escalate severity of findings from automated heuristics (pass 0) without corroborating evidence, (3) instruct the LLM to not generate specific file decomposition suggestions unless the underlying metric exceeds 2x the threshold.

**Acceptance Criteria**

- Meta-evaluation prompt includes source pass and detection method for each finding
- LLM is instructed to not escalate heuristic findings without corroboration
- After fixing features 1-3, re-running analysis produces no false critical-severity LLM recommendations

---
