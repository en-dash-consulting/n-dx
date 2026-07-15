---
id: "6f4360a7-c982-41c6-a46c-329115e8aab6"
level: "epic"
title: "Windows CLI Spawn Hardening"
status: "completed"
priority: "high"
tags:
  - "windows"
  - "reliability"
  - "llm-client"
  - "gh:37"
  - "gh:68"
  - "gh:69"
source: "github-issue-37"
startedAt: "2026-07-13T15:42:48.255Z"
completedAt: "2026-07-13T15:42:48.255Z"
endedAt: "2026-07-13T15:42:48.255Z"
description: "Combined fix for GitHub issues #37 (P0), #68, #69 — all one root cause: n-dx invokes CLI binaries (claude/codex) on Windows via the fragile `shell: process.platform === \"win32\"` pattern at three spawn sites (llm-client cli-provider.ts, llm-client codex-cli-provider.ts, hench cli-loop.ts). That workaround mitigates EINVAL but (a) triggers Node's [DEP0190] deprecation for shell:true+args (#69) and (b) fails to quote binary paths containing spaces (#68). Replace all three fragile guards with one centralized Windows-safe spawn helper that invokes .cmd shims via cmd.exe with a self-quoted verbatim command line. Tracked by GH #37; PR will close #37/#68/#69. Advances #42; rolls up under #92."
---

## Children

| Title | Status |
|-------|--------|
| [Add centralized spawnCli Windows-safe helper](./add-centralized-spawncli-752587.md) | completed |
| [Add diagnoseCliInvocation helper and wire it into spawn error paths (closes #68)](./add-diagnosecliinvocation-5a7bcd.md) | completed |
| [Changeset and cross-shell validation](./changeset-and-cross-shell-validation.md) | completed |
| [Codex hench adapter: deliver prompt via stdin instead of argv (cmd.exe newline injection)](./codex-hench-adapter-deliver-4cfcaa.md) | completed |
| [DEP0190 guard test: fail if any CLI spawn reintroduces shell:true](./dep0190-guard-test-fail-if-any-ba6e02.md) | completed |
| [Fix quoteWindowsToken: unconditional quoting + ArgvQuote backslash rules (both copies) with parity test](./fix-quotewindowstoken-acf2fb.md) | completed |
| [Fix Windows not-found diagnostics: hench close-path detection, pattern anchoring, absolute-path diagnosis, codex stdin guard](./fix-windows-not-found-3bc11e.md) | completed |
| [PR #299 post-review: merge latest main (Hal's #298 overlap) and review cleanup](./pr-299-post-review-merge-latest-a98240.md) | completed |
| [Remove claude-cli-adapter manual --allowed-tools pre-quoting (double-quoting regression)](./remove-claude-cli-adapter-6b7def.md) | completed |
| [Route remaining in-scope spawn sites: pair-programming.js and sourcevision rex spawns](./route-remaining-in-scope-spawn-ab2081.md) | completed |
| [Route the four CLI spawn sites through spawnCli](./route-the-four-cli-spawn-sites-a585ca.md) | completed |
