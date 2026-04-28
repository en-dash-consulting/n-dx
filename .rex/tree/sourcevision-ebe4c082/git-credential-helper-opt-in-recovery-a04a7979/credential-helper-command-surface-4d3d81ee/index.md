---
id: "4d3d81ee-2ec5-486c-a768-d0b0a333b90d"
level: "task"
title: "Credential Helper Command Surface"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T01:20:36.708Z"
completedAt: "2026-02-23T01:20:36.708Z"
description: "Provide an explicit, user-invoked path to set up git credentials after authentication-related refresh failures without introducing interactive prompts into default flows."
---

## Subtask: Add opt-in git credential helper command to CLI

**ID:** `d4dce138-cf33-4c06-a6c3-a8e01b54ce2c`
**Status:** completed
**Priority:** high

Create a dedicated command users can run on demand to diagnose and set up git credentials, so remediation is explicit and repeatable instead of embedded in normal refresh execution.

**Acceptance Criteria**

- Running the command starts a credential setup workflow only when explicitly invoked
- The command is discoverable in CLI help output with usage and examples
- Command exits with code 0 on successful setup checks and non-zero on unrecoverable setup errors

---

## Subtask: Implement provider-aware auth checks and login handoff

**ID:** `9f5d63a7-cac0-40bd-9c37-752c58824e86`
**Status:** completed
**Priority:** high

Support practical setup paths by checking `gh auth status` when GitHub CLI is available and providing platform credential-manager guidance when it is not, reducing manual troubleshooting.

**Acceptance Criteria**

- If `gh` is installed, workflow runs `gh auth status` and offers `gh auth login` handoff when unauthenticated
- If `gh` is not installed, workflow returns OS-specific credential setup guidance text
- Workflow output distinguishes between authenticated, unauthenticated, and tool-unavailable states

---
