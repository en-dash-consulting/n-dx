---
id: "6b7def28-de13-4a56-a8d0-d0eae3833983"
level: "task"
title: "Remove claude-cli-adapter manual --allowed-tools pre-quoting (double-quoting regression)"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "hench"
  - "gh:37"
  - "audit-remediation"
blockedBy:
  - "acf2fb32-29dd-495c-ba2c-f871fd21c1b9"
source: "fable-audit-2026-07-10"
acceptanceCriteria:
  - "TDD: failing test first asserting the Windows --allowed-tools token contains no literal double-quote characters"
  - "Manual pre-quoting removed; spawnCli/quoteWindowsToken is the single quoting authority"
  - "Round-trip test: allowed-tools token through buildWindowsCliCommandLine is quoted exactly once (no doubled quotes)"
  - "Existing claude-cli-adapter tests updated and green"
description: "packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts (~line 103) manually wraps the joined --allowed-tools value in literal double quotes on Windows (`\"${input.allowedTools.join(\",\")}\"`) — a workaround for the OLD `shell:true` spawn that passed args raw to cmd.exe. Now that spawnCli quotes every token itself, the pre-wrapped token contains a double-quote character, so quoteWindowsToken re-wraps it and doubles the embedded quotes; the claude CLI receives the value WITH literal quote characters and tool-permission patterns fail to match (autonomous runs stall on permission prompts). Fix: remove the manual quoting — on Windows pass the joined value as a plain token exactly like the non-Windows branch joins per-arg (keep the single-comma-joined-arg shape if that is what the claude CLI expects on Windows; just drop the added quote characters). DEPENDS on the unconditional-quoting task: the unwrapped token contains parentheses (e.g. Bash(git:*)) with no spaces, which conditional quoting would leave bare to cmd.exe — unconditional quoting must land first. TDD: a unit test on buildSpawnConfig asserting the Windows args contain NO literal quote characters in the allowed-tools token, plus a round-trip test pushing the token through buildWindowsCliCommandLine asserting the final command line quotes it exactly once."
---
