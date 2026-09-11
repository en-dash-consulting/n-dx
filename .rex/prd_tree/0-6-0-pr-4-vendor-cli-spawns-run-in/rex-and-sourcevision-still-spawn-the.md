---
id: "5323b1af-0806-4852-92a8-d856def55b28"
level: "task"
title: "rex and sourcevision still spawn the vendor CLI without a cwd"
status: "pending"
priority: "medium"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-04-review"
source: "review of PR 4, 2026-09-11"
acceptanceCriteria:
  - "rex analyze <dir> invoked from an unrelated cwd spawns the vendor CLI with cwd = <dir>."
  - "sv analyze <dir> does the same."
  - "Unit tests assert the spawn options carry the project dir, mirroring packages/llm-client/tests/unit/cli-provider-cwd.test.ts."
  - "No behaviour change when the CLI is already invoked from the project directory (the common case)."
description: "Severity: medium. Found by review of PR 4, which fixed the same defect for the dashboard's Ask route only.\n\nFAILURE SCENARIO\nPR 4 threaded a `cwd` through createLLMClient → spawnOnce → spawnCli so the Ask route spawns the vendor CLI in ctx.projectDir. Three other call sites were left passing no cwd, so they still inherit the calling process's working directory:\n\n  - packages/rex/src/analyze/llm-bridge.ts:131 and :168\n  - packages/sourcevision/src/analyzers/claude-client.ts:129\n\nConcretely: `rex analyze /path/to/other-project` run from ~ spawns `claude -p` with cwd = ~, not the project being analyzed. The vendor CLI then resolves its project context — CLAUDE.md, and after PR 3 the tracked .mcp.json — against the wrong directory.\n\nWHY THIS MATTERS MORE AFTER PR 3\nPR 3 makes MCP registration cwd-relative on purpose: `.mcp.json` invokes `ndx rex mcp .` so the server targets whatever checkout the client opened. That design is correct, and it makes a wrong cwd consequential rather than cosmetic — an analysis run spawned in the wrong directory can pick up a different project's MCP registration entirely.\n\nWHY IT WAS OUT OF PR 4's SCOPE\nBoth remaining sites are module-level lazy singletons (`_llmClient`) created by a zero-argument `getClient()` with no project directory in scope. Passing a cwd means threading a project dir into those modules or their existing config-injection seam (`_llmConfig`), which is a larger change than the Ask route's one-line fix and deserves its own review.\n\nSOLUTION OPTIONS\n(A) Thread the project dir through the existing config seam. Both modules already take an injected `_llmConfig`; add the project dir alongside it at the same injection points, and pass it as `cwd`. Smallest change that keeps the singleton shape.\n(B) Make getClient() take the project dir as a parameter and drop the module-level singleton, or key the singleton by dir. Cleaner, but touches every caller.\n(C) Have the CLI entry points chdir to the resolved project dir before analysis. Simplest, but process-global and hostile to the in-process/server use cases.\n\nPrefer (A)."
lastModified: "2026-09-11T18:31:25.369Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
