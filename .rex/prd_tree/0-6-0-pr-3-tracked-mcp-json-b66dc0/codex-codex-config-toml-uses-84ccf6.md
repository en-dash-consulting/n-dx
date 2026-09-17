---
id: "84ccf6bc-ea8c-441a-ab97-692826bab26a"
level: "task"
title: "Codex .codex/config.toml uses the same cwd-relative MCP commands"
status: "completed"
priority: "high"
tags:
  - "pr-03"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T14:16:56.768Z"
completedAt: "2026-09-11T14:31:10.597Z"
endedAt: "2026-09-11T14:31:10.597Z"
acceptanceCriteria:
  - "Generated .codex/config.toml has no absolute paths and both servers start under Codex from any worktree."
  - "codex-config-validation test asserts the new shape."
description: "packages/core/codex-integration.js renderCodexConfigToml currently embeds resolveSubPackageCli() absolute dist paths and the absolute project dir. Switch to command = \"ndx\" with args [\"rex\",\"mcp\",\".\"] / [\"sv\",\"mcp\",\".\"] (Codex launches stdio servers with cwd at the project root). Keep the file gitignored as today unless the team decides otherwise; update docs/archive/codex-transport-artifact-decisions.md only with a dated note, do not rewrite it. tests/integration/codex-config-validation.test.js must be updated to assert no absolute paths."
lastModified: "2026-09-11T14:31:10.605Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
