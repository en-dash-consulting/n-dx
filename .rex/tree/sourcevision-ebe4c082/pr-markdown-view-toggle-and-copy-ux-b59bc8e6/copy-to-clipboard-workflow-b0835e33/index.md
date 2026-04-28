---
id: "b0835e33-c7d9-427e-9d8b-813838d6ee48"
level: "task"
title: "Copy-to-Clipboard Workflow"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T05:07:01.629Z"
completedAt: "2026-02-23T05:07:01.629Z"
description: "Provide a reliable one-click copy action for raw PR markdown with clear success and failure feedback."
---

## Subtask: Add one-click copy action for raw markdown content

**ID:** `b1adb5cc-eada-42e2-a43b-8d131cd59d3a`
**Status:** completed
**Priority:** high

Implement a dedicated copy button that copies the full generated markdown to clipboard so users can paste directly into PR comments.

**Acceptance Criteria**

- Clicking copy places the complete raw markdown text on the clipboard
- Copy action is available in Raw mode without selecting text manually
- Automated UI test verifies clipboard write call with exact markdown payload

---

## Subtask: Render copy status and fallback guidance

**ID:** `10842c9c-4c80-4976-b784-9c9acfdcce47`
**Status:** completed
**Priority:** medium

Show immediate success/error feedback for clipboard operations and provide fallback instructions when browser permissions block clipboard access.

**Acceptance Criteria**

- Successful copy displays a visible confirmation message
- Clipboard failures display an error message with manual copy guidance
- Tests cover success and permission-denied clipboard scenarios

---
