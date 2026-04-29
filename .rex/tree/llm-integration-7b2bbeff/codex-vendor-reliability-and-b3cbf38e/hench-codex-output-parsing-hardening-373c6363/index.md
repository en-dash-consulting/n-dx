---
id: "373c6363-4810-416d-9ce8-c38dfd850c96"
level: "task"
title: "Hench Codex Output Parsing Hardening"
status: "completed"
source: "smart-add"
startedAt: "2026-02-20T22:31:32.197Z"
completedAt: "2026-02-20T22:31:32.197Z"
acceptanceCriteria: []
description: "Make Hench resilient to Codex-mode response variations so task execution state is derived consistently even when tool output shape changes."
---

## Subtask: Implement normalized Codex response extraction in Hench run parser

**ID:** `6f6112ac-1db6-4a44-a856-c2b616e9409d`
**Status:** completed
**Priority:** critical

Add a dedicated normalization layer that converts Codex-mode responses (including tool calls, partial text blocks, and completion markers) into the internal run event format used by Hench.

**Acceptance Criteria**

- Parser accepts Codex responses with mixed text and tool-use blocks without throwing
- Normalized output always includes status, assistant message text, and tool event metadata when present
- Unknown block types are safely ignored with a warning instead of failing the run

---

## Subtask: Add regression tests for malformed and partial Codex outputs

**ID:** `c7fd1ec7-b523-44e1-b6ba-81d5925af64e`
**Status:** completed
**Priority:** high

Prevent future breakage by codifying edge cases seen in Codex mode, including truncated payloads and missing optional fields, so parser behavior is stable across vendor updates.

**Acceptance Criteria**

- Test suite includes fixtures for truncated responses, empty content arrays, and missing usage fields
- All malformed fixtures produce deterministic fallback behavior with no uncaught exceptions
- CI passes with new parser tests enabled in the Hench test target

---
