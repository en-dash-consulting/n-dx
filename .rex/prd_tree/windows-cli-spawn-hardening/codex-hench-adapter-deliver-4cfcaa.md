---
id: "4cfcaad0-0e95-488c-950d-17c7f97c62b9"
level: "task"
title: "Codex hench adapter: deliver prompt via stdin instead of argv (cmd.exe newline injection)"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "hench"
  - "security"
  - "gh:37"
  - "audit-remediation"
blockedBy:
  - "3bc11e6e-5112-49fd-a638-ee73aa520c17"
source: "fable-audit-2026-07-10"
acceptanceCriteria:
  - "TDD: failing test first — codex buildSpawnConfig puts the prompt in stdinContent and '-' in args; no multi-line token remains in argv"
  - "cli-loop stdin piping path exercised for codex (stdinMode 'pipe')"
  - "Existing codex adapter/cli-loop tests updated and green"
  - "Comment explains the cmd.exe newline (BatBadBut) rationale so it is not reverted to argv"
description: "packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts (~650-670) passes the ENTIRE multi-line prompt (SYSTEM:\n...\nTASK:\n...) as a positional argv token with stdinContent:null. On Windows every argv token now flows through a cmd.exe command line, and cmd.exe treats embedded CR/LF as command separators regardless of quoting (BatBadBut / CVE-2024-24576 class): the prompt truncates at the first newline and subsequent lines — arbitrary PRD/task text — can execute as shell commands. This is PRE-EXISTING (the old shell:true had the same exposure) but must not survive a Windows-hardening PR. Fix at the adapter: deliver the prompt via stdin exactly like llm-client's own codex-cli-provider already does — append \"-\" as the positional prompt argument and set stdinContent to the combined prompt (the claude adapter already uses stdin; mirror that plumbing through cli-loop's existing stdinContent handling). Verify `codex exec -` reads the prompt from stdin (the llm-client provider relies on exactly this). No quoting change can make multi-line argv safe through cmd.exe — stdin is the only correct fix. TDD: failing test first asserting buildSpawnConfig returns stdinContent === combined prompt and args end with \"-\" (no prompt text in args)."
---
