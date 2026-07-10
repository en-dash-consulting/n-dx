---
id: "6f4360a7-c982-41c6-a46c-329115e8aab6"
level: "epic"
title: "Windows CLI Spawn Hardening"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "reliability"
  - "llm-client"
  - "gh:37"
  - "gh:68"
  - "gh:69"
source: "github-issue-37"
description: "Combined fix for GitHub issues #37 (P0), #68, #69 — all one root cause: n-dx invokes CLI binaries (claude/codex) on Windows via the fragile `shell: process.platform === \"win32\"` pattern at three spawn sites (llm-client cli-provider.ts, llm-client codex-cli-provider.ts, hench cli-loop.ts). That workaround mitigates EINVAL but (a) triggers Node's [DEP0190] deprecation for shell:true+args (#69) and (b) fails to quote binary paths containing spaces (#68). Replace all three fragile guards with one centralized Windows-safe spawn helper that invokes .cmd shims via cmd.exe with a self-quoted verbatim command line. Tracked by GH #37; PR will close #37/#68/#69. Advances #42; rolls up under #92."
---

## Children

| Title | Status |
|-------|--------|
| [Add centralized spawnCli Windows-safe helper](./add-centralized-spawncli-752587.md) | pending |
| [Add diagnoseCliInvocation helper and wire it into spawn error paths (closes #68)](./add-diagnosecliinvocation-5a7bcd.md) | pending |
| [Changeset and cross-shell validation](./changeset-and-cross-shell-validation.md) | pending |
| [DEP0190 guard test: fail if any CLI spawn reintroduces shell:true](./dep0190-guard-test-fail-if-any-ba6e02.md) | pending |
| [Route the four CLI spawn sites through spawnCli](./route-the-four-cli-spawn-sites-a585ca.md) | pending |
