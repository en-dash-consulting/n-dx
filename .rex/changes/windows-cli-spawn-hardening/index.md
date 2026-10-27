---
id: "6f4360a7-c982-41c6-a46c-329115e8aab6"
type: "change"
title: "Windows CLI Spawn Hardening"
slug: "windows-cli-spawn-hardening"
intent: "Combined fix for GitHub issues #37 (P0), #68, #69 — all one root cause: n-dx invokes CLI binaries (claude/codex) on Windows via the fragile `shell: process.platform === \"win32\"` pattern at three spawn sites (llm-client cli-provider.ts, llm-client codex-cli-provider.ts, hench cli-loop.ts). That workaround mitigates EINVAL but (a) triggers Node's [DEP0190] deprecation for shell:true+args (#69) and (b) fails to quote binary paths containing spaces (#68). Replace all three fragile guards with one centralized Windows-safe spawn helper that invokes .cmd shims via cmd.exe with a self-quoted verbatim command line. Tracked by GH #37; PR will close #37/#68/#69. Advances #42; rolls up under #92."
touches:
  - "3bc1cab2-ebb4-4f6a-8d4f-a19e3fb22a09"
priority: "high"
tags:
  - "windows"
  - "reliability"
  - "llm-client"
  - "gh:37"
  - "gh:68"
  - "gh:69"
source: "github-issue-37"
---
