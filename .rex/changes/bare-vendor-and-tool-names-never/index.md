---
id: "5d6488b3-6ce5-45cb-b3a8-8465daa4bee8"
type: "change"
title: "Bare vendor and tool names never resolve to a binary in the checkout on Windows"
slug: "bare-vendor-and-tool-names-never"
intent: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass finding 6 (low; Windows only, read from libuv's documented search order, not probed).\n\nFailure scenario: on Windows, spawning a bare name (claude, codex, pnpm) with cwd = projectDir searches the child's working directory before PATH. A repository that commits claude.exe at its root has it run when the dashboard's LLM catalog loads (llm-catalog.ts `--version` probe), and every vendor CLI spawn with cwd = project shares the same root cause. `ndx ci`'s pnpm is affected too, though docs:build already runs repository code.\n\nFix: resolve bare vendor and tool names to an absolute path from PATH, skipping relative PATH entries and anything inside the checkout, before spawning with cwd = projectDir. Do it in one llm-client helper used by every spawn site."
acceptanceCriteria:
  - "On Windows, a claude.exe, codex.exe or pnpm.cmd committed at the project root is never what a bare-name spawn runs"
  - "Test (resolution unit test, runnable on any platform): the resolver skips the project directory and relative PATH entries"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
