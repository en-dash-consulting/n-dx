---
id: "26c7a348-54a8-42e4-b06f-1de63b93764c"
level: "task"
title: "Rex and Hench Vendor Behavior Documentation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-20T23:12:36.052Z"
completedAt: "2026-02-20T23:12:36.052Z"
description: "Clarify how Rex and Hench behave across vendors, with explicit notes for Codex mode, to reduce operator confusion and support issues."
---

## Subtask: Update README vendor matrix for Rex and Hench behavior differences

**ID:** `4d1d39f0-c539-4ecd-a153-d488c0873667`
**Status:** completed
**Priority:** medium

Document per-vendor expectations for parsing, token accounting, and fallback behavior so users can choose providers with clear tradeoffs.

**Acceptance Criteria**

- README includes a Rex/Hench vendor behavior section with Codex and Claude rows
- Matrix explicitly lists token accounting support and known parsing constraints per vendor
- Documentation references the relevant CLI/config options for selecting vendors

---

## Subtask: Revise CODEX guidance with troubleshooting for parsing and usage discrepancies

**ID:** `a16f4e6d-e29d-46a6-b406-2336679a7ce3`
**Status:** completed
**Priority:** medium

Add operational guidance for diagnosing Codex-mode output parsing failures and token mismatches, including expected logs and remediation steps.

**Acceptance Criteria**

- CODEX documentation includes a troubleshooting section for malformed output and missing usage fields
- Each issue includes concrete verification steps and expected command outcomes
- Docs are consistent with implemented parser fallback and token-mapping behavior

---
