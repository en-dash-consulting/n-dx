---
id: "bf77cd72-51fc-4940-ac25-842a034d35cd"
level: "task"
title: "Per-event vendor/model metadata capture"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T21:25:22.791Z"
completedAt: "2026-02-21T21:25:22.791Z"
description: "Ensure every token usage event records the actual LLM vendor and model used at execution time so later reporting is based on facts, not mutable config."
---

## Subtask: Persist vendor/model on Rex token usage events

**ID:** `2865f495-7610-4bbb-8fe7-f13a08c4d161`
**Status:** completed
**Priority:** critical

Update Rex usage event emission to attach vendor and model from the active request context so each event is self-describing and survives config changes.

**Acceptance Criteria**

- Each newly written Rex token event includes non-empty vendor and model fields when provider metadata is available
- If provider metadata is unavailable, Rex writes explicit fallback values (for example "unknown") instead of omitting fields
- Existing Rex event schema validation passes with the new metadata fields present

---

## Subtask: Persist vendor/model on Hench token usage events

**ID:** `98100579-8582-4b4c-a70f-40324b1117aa`
**Status:** completed
**Priority:** critical

Capture vendor/model at the moment Hench records run and task token usage so mixed-provider runs are attributed correctly per event.

**Acceptance Criteria**

- New Hench token events include vendor and model fields derived from actual run execution metadata
- Events produced by retries or multi-step runs preserve the vendor/model used for each individual event
- Hench run summary generation continues to work without schema errors after metadata addition

---

## Subtask: Persist vendor/model on SourceVision token usage events

**ID:** `6f7284f8-c3b3-4fb0-9dc0-8a07b9e8f43d`
**Status:** completed
**Priority:** high

Add vendor/model attribution to SourceVision analysis token events so analysis usage is grouped by actual model invocation details.

**Acceptance Criteria**

- SourceVision token events written during analyze flows include vendor and model fields
- When model resolution falls back, SourceVision records the resolved fallback model in the event metadata
- SourceVision token event parsing and display paths handle the new metadata without regression

---
