---
id: "63592288-b8af-4c43-94a9-79d1e5708866"
level: "task"
title: "Tests: init writes .mcp.json; generated MCP configs contain no absolute paths"
status: "completed"
priority: "high"
tags:
  - "pr-03"
  - "core"
  - "tests"
blockedBy:
  - "97fbaef0-3691-42b7-9149-70a0bc9aa5b2"
  - "84ccf6bc-ea8c-441a-ab97-692826bab26a"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T14:41:32.173Z"
completedAt: "2026-09-11T17:10:44.600Z"
endedAt: "2026-09-11T17:10:44.600Z"
acceptanceCriteria:
  - "Tests fail if an absolute path reappears in either generated MCP config."
  - "Full root suite passes."
description: "Extend tests/integration/claude-config-validation.test.js and codex-config-validation.test.js: assert .mcp.json shape, idempotent merge, no absolute paths in either generated config, and that the gitignore snippet does not list .mcp.json. Add a unit test that `ndx rex mcp .` resolves the directory to cwd (packages/rex resolveDir behaviour) so the cwd-relative contract is pinned."
lastModified: "2026-09-11T17:10:44.607Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
