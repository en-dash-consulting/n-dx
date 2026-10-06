---
id: "d8f66268-82db-4f68-ae89-bbc0978d6263"
level: "task"
title: "Pass llm.effort to Claude Code CLI runs via --effort"
status: "pending"
priority: "low"
tags:
  - "follow-up"
  - "llm-models"
source: "manual"
acceptanceCriteria:
  - "A matching llm.effort rule reaches the Claude Code spawn as --effort <level> for both the llm-client CLI provider and hench's cli-loop"
  - "Invalid values and non-capable models are dropped with the same warnings as the API path"
  - "Unit tests assert on the spawned argv"
description: "Follow-up from 0694393f (Claude API effort). The Claude Messages API paths now send llm.effort as output_config.effort through resolveClaudeApiEffort (packages/llm-client/src/claude-effort.ts). Claude Code CLI runs still ignore it: llm-client cli-provider.ts drops CompletionRequest.effort, and hench's cli-loop spawn passes no --effort. Claude Code has an --effort flag and chooses its own default. Decide whether CLI runs should honour llm.effort (and whether the Opus 5.5 → high default applies there, given that Claude Code picks its own), then pass --effort with the same validation (valid levels, allowlist of effort-capable models)."
lastModified: "2026-10-02T05:43:58.913Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
