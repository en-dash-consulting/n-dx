---
id: "aafa20ab-a99a-439f-b86d-84d1504b711a"
level: "task"
title: "Non-Interactive Refresh Compatibility"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T00:35:58.630Z"
completedAt: "2026-02-23T00:35:58.630Z"
description: "Integrate credential helper guidance into failure handling while preserving default non-interactive behavior for automated and scripted refresh runs."
---

## Subtask: Classify git auth failures and attach opt-in remediation hints

**ID:** `49d8b51b-bba4-4c86-879d-ef4214a29094`
**Status:** completed
**Priority:** critical

When refresh fails due to credential or auth issues, return a specific failure classification with a clear suggestion to run the new helper command instead of generic git errors.

**Acceptance Criteria**

- Auth-related fetch failures map to a dedicated error classification distinct from network/history failures
- Failure payload includes the exact opt-in helper command users should run next
- Non-auth git failures do not include credential-helper remediation hints

---

## Subtask: Enforce non-interactive default behavior in refresh path

**ID:** `0030ced7-ebfd-4231-b482-9b9f593ac578`
**Status:** completed
**Priority:** critical

Ensure refresh never opens interactive credential flows unless explicitly requested, preventing hangs in CI and preserving existing automation behavior.

**Acceptance Criteria**

- Default refresh execution does not invoke `gh auth login` or any interactive credential prompt
- Interactive helper flow runs only through explicit user opt-in command or explicit opt-in flag
- Integration tests verify CI-like non-TTY refresh continues to fail fast with actionable guidance

---
