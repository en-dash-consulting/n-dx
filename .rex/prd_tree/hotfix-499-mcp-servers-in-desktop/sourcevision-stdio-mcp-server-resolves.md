---
id: "fdfca018-9adf-441c-80fc-dd22994f1ac1"
level: "task"
title: "Sourcevision stdio MCP server resolves its workspace from the client's MCP roots"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "mcp"
  - "worktree"
blockedBy:
  - "e07c43d4-065b-481d-b996-dad39da83d26"
source: "ndx-capture"
startedAt: "2026-10-05T19:12:04.131Z"
completedAt: "2026-10-05T19:21:09.268Z"
endedAt: "2026-10-05T19:21:09.268Z"
resolutionType: "code-change"
resolutionDetail: "sv stdio MCP server follows client roots via llm-client resolveWorkspaceFromRoots; integration test added; commit e015035cf"
acceptanceCriteria:
  - "A session in worktree B whose sv MCP server started with cwd = main checkout A reads B's .sourcevision/ (get_overview, get_zone, get_findings…) and set_file_archetype writes B's .sourcevision/, not A's."
  - "Uses the @n-dx/llm-client resolveWorkspaceFromRoots helper from the rex task with marker '.sourcevision'; no logic is duplicated and no rex import is added."
  - "A same-repo worktree root without .sourcevision/ refuses set_file_archetype with a message naming both paths; reads fall back to the startup dir with a warning."
  - "Clients without roots, explicit absolute dirs, and the web HTTP factory (packages/web/src/server/domain-gateway.ts → createSourcevisionMcpServer) behave as today."
  - "An integration test spawns the real `sv mcp .` with cwd=A and a roots client naming B."
description: "Where: packages/sourcevision/src/cli/mcp.ts. startMcpServer(targetDir) resolves absDir, exits if absDir/.sourcevision is missing, then createSourcevisionMcpServer(absDir). The server's `context` (context.freshData() etc.) captures the dir.\n\nApply the pattern the rex task introduced:\n- stdio-only opt-in;\n- only when the dir is the implicit cwd;\n- resolve on oninitialized and on notifications/roots/list_changed;\n- calls await the first resolution (bounded about 2 s);\n- rebuild the context for the new dir;\n- one stderr line on rebind;\n- `refused` blocks set_file_archetype (the only write).\n\nKeep the existing startup exit when the STARTUP dir has no .sourcevision/: the main checkout normally has one. If the startup dir lacks it but a client root has it, serving the root is acceptable; decide and test that.\n\nIntegration test mirrors the rex one. Use a tmp repo with a minimal .sourcevision/ fixture in both checkouts that differ in content, so the read case can tell which one was served.\n\nChangeset: @n-dx/sourcevision patch.\n\n## Retry notes (run cf48a248, 2026-10-05: failed at the test gate)\n\nThe first attempt left its work uncommitted in this worktree: packages/sourcevision/src/cli/mcp.ts (modified), src/cli/mcp-workspace.ts, tests/integration/mcp-client-roots.test.ts and .changeset/sv-mcp-client-roots.md. Keep that work and finish it; do not start over.\n\nWhy it failed:\n1. The integration test spawns packages/sourcevision/dist/cli/index.js, and dist was never rebuilt, so the test exercised the OLD server. That caused 3 of the 4 failures. After a build those 3 pass, and so does `tsc` (checked by hand).\n2. The one real failure is in the test, not the server. In 'sv mcp . in a directory without .sourcevision/ › exits at startup', the sv CLI entry rejects before startMcpServer runs, with `[NDX_CLI_NOT_INITIALIZED] Sourcevision directory not found in <dir>` (src/cli/errors.ts). Assert on that message, or on the exit code plus 'Sourcevision directory not found'. Do not add a second check to the server.\n\nCommands. Use exactly these forms, because they are on the permission allowlist. `pnpm run typecheck`, `npx tsc`, `pnpm exec tsc` and `./node_modules/.bin/tsc` are NOT, and they stall the run on an approval prompt:\n- build (also typechecks): `pnpm --filter @n-dx/sourcevision build`\n- the new test: `pnpm --filter @n-dx/sourcevision exec vitest run tests/integration/mcp-client-roots.test.ts`\n- typecheck: `pnpm --filter @n-dx/sourcevision typecheck`\n- full suite before done: `pnpm test`\nRebuild after every source change before running the integration test."
lastModified: "2026-10-05T19:21:09.678Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
