---
id: "c6c06d43-c2d9-4da8-b68a-ecfaf946d305"
level: "task"
title: "Token Usage Tracking"
status: "completed"
source: "llm"
startedAt: "2026-02-08T16:20:01.865Z"
completedAt: "2026-02-08T16:20:01.865Z"
description: "Comprehensive tracking and reporting of Claude API token consumption"
---

## Subtask: Implement token extraction from API responses

**ID:** `553cef28-1f04-4870-9d1a-678dbed19668`
**Status:** completed
**Priority:** high

Extract token usage data from Claude API streaming responses

**Acceptance Criteria**

- Extracts token usage from assistant event with message.usage
- Extracts cache token fields from assistant event
- Does not set cache fields when not present in usage
- Handles assistant event without usage field
- Extracts fallback token totals from result event
- Does not overwrite per-turn accumulated tokens from result event
- Handles string message assistant events (no usage)
- Ignores non-JSON lines

---

## Subtask: Build token accumulation system

**ID:** `8aa36d0d-ee60-45cb-9e1a-9a404b187ca4`
**Status:** completed
**Priority:** medium

Accumulate token usage across multiple API turns and sessions

**Acceptance Criteria**

- Accumulates tokens across multiple turns
- Accumulates cache tokens across turns
- Accumulates cache tokens when present
- Accumulates across multiple log entries
- Does not set cache fields when not provided

---

## Subtask: Implement token budget controls

**ID:** `66ccb0ca-13f1-44e2-bd6d-8fae2359b0c2`
**Status:** completed
**Priority:** medium

Enforce token budget limits and provide budget checking

**Acceptance Criteria**

- Counts both input and output tokens toward budget
- Handles zero usage correctly

---

## Subtask: Improve token usage parsing

**ID:** `7514d08b-4b97-4eea-9108-8b10e06f81d5`
**Status:** completed
**Priority:** medium

Enhance parsing of token usage from Claude API streaming responses

**Acceptance Criteria**

- extracts tokens from top-level fields
- extracts from nested usage object
- extracts cache tokens from nested usage object
- prefers top-level fields over nested usage

---

## Subtask: Enhance token usage parsing from API responses

**ID:** `f8c7d2fe-52eb-4960-a728-43f60523f37e`
**Status:** completed
**Priority:** medium

Implement robust token extraction that handles various API response formats and fields

**Acceptance Criteria**

- extracts input and output tokens from envelope
- extracts total_input/output_tokens as fallback
- prefers input_tokens over total_input_tokens
- extracts cache token fields when present
- omits cache fields when they are zero
- handles partial fields (only input or output)

---

## Subtask: Implement token usage accumulation and formatting

**ID:** `a9a9d413-1372-4cc4-841a-44c0c214f46a`
**Status:** completed
**Priority:** medium

Build system to accumulate token usage across calls and format for display

**Acceptance Criteria**

- increments call count even when usage is undefined
- accumulates input and output tokens
- formats single call without call count
- formats multiple calls with call count

---
