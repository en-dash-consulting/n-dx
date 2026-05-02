---
id: "ac39fe86-e0af-4b0d-b3b0-87bc26d81399"
level: "task"
title: "Implement multi-location Claude CLI discovery chain with configurable override"
status: "completed"
priority: "high"
tags:
  - "init"
  - "cli-discovery"
  - "cross-platform"
source: "smart-add"
startedAt: "2026-04-10T16:15:12.695Z"
completedAt: "2026-04-10T16:27:02.356Z"
acceptanceCriteria:
  - "ndx init succeeds when claude is installed via npm global, Homebrew, or the Claude desktop app and is not on the invoking shell's PATH"
  - "CLAUDE_CLI_PATH environment variable, when set, takes precedence over all discovery heuristics"
  - "cli.claudePath key in .n-dx.json overrides discovery and is documented in ndx config --help"
  - "Resolved path is written to .hench/config.json on successful discovery"
  - "Discovery logic is exercised by a unit test that stubs PATH and file-existence checks for each platform"
description: "Replace the current single PATH lookup for the claude binary with an ordered discovery chain that checks: (1) a user-configured path from .n-dx.json or CLAUDE_CLI_PATH env var, (2) the shell PATH, (3) well-known install locations (~/.claude/local/claude, ~/.nvm/versions/node/*/bin/claude, /usr/local/bin, /opt/homebrew/bin, %APPDATA%\npm\\claude.cmd on Windows). The resolved path should be persisted in .hench/config.json so subsequent commands reuse it without re-discovering each time."
---

# Implement multi-location Claude CLI discovery chain with configurable override

🟠 [completed]

## Summary

Replace the current single PATH lookup for the claude binary with an ordered discovery chain that checks: (1) a user-configured path from .n-dx.json or CLAUDE_CLI_PATH env var, (2) the shell PATH, (3) well-known install locations (~/.claude/local/claude, ~/.nvm/versions/node/*/bin/claude, /usr/local/bin, /opt/homebrew/bin, %APPDATA%
pm\claude.cmd on Windows). The resolved path should be persisted in .hench/config.json so subsequent commands reuse it without re-discovering each time.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** init, cli-discovery, cross-platform
- **Level:** task
- **Started:** 2026-04-10T16:15:12.695Z
- **Completed:** 2026-04-10T16:27:02.356Z
- **Duration:** 11m
