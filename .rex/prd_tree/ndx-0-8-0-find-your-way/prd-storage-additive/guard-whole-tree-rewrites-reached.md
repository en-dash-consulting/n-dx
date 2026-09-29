---
id: "25d1ace2-b651-4ba5-a83a-39fcfa901508"
level: "task"
title: "Guard whole-tree rewrites reached through the rex MCP reorganize tool and the dashboard's bulk routes"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "prd-storage-additive"
source: "adversarial review of hench run 5a210edb (task bdaf93b2), 0.8.0 PR B2"
acceptanceCriteria:
  - "The MCP reorganize tool refuses to apply proposals off the default branch unless an explicit opt-in parameter is passed, and the refusal names the branch."
  - "The dashboard's bulk prune and reshape-accept routes refuse off the default branch, naming the branch."
  - "Read-only previews through MCP and the dashboard are unaffected."
  - "A test spawns the built rex CLI with --allow-on-branch <dir>, the argv form hench and web use."
description: "Follow-up to bdaf93b2, which guards only the CLI commands. The review of run 5a210edb found that these entry points bypass the guard: the rex MCP reorganize tool applies proposals inside store.withTransaction with no branch check (packages/rex/src/cli/mcp-tools.ts:789), and the dashboard's bulk prune route does the same (packages/web/src/server/routes-rex/prune.ts:434). Closing them needs an opt-in surface that the CLI flag does not provide (for example a tool parameter or a request field), which is a design decision left out of bdaf93b2's scope."
lastModified: "2026-09-28T23:53:05.046Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
