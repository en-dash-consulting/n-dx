---
id: "6674ca7d-7b4e-4f59-94cc-d720a87cd4e7"
level: "task"
title: "SourceVision PR Markdown Tab Experience"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T04:57:13.897Z"
completedAt: "2026-02-21T04:57:13.897Z"
description: "Add a dedicated, easy-to-access UI surface in localhost that continuously presents the latest PR markdown and supports quick copy/paste workflows."
---

## Subtask: Add PR Markdown tab to SourceVision navigation and routing

**ID:** `f0b4d176-3cb9-4205-a65d-3f1515eddaa9`
**Status:** completed
**Priority:** critical

Expose a first-class tab so users can find PR-ready output without leaving SourceVision or running separate commands.

**Acceptance Criteria**

- Sidebar or section navigation includes a PR Markdown entry under SourceVision
- Selecting the tab updates URL/hash routing consistently with existing patterns
- Tab loads without breaking existing SourceVision views
- Tab displays initial loading, success, and empty states

---

## Subtask: Render copy-ready markdown preview with raw text access

**ID:** `06c00905-2787-4586-a12a-3ac83e2a0dc3`
**Status:** completed
**Priority:** high

Provide a readable preview and direct raw markdown copy path so users can quickly transfer content into pull request descriptions.

**Acceptance Criteria**

- UI shows rendered markdown preview and corresponding raw markdown text
- Copy action places full raw markdown content on clipboard
- Copied content preserves headings, lists, and code fences
- Copy control provides visible success/failure feedback

---
