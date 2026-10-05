---
id: "fdfca018-9adf-441c-80fc-dd22994f1ac1"
level: "task"
title: "Sourcevision stdio MCP server resolves its workspace from the client's MCP roots"
status: "pending"
priority: "high"
tags:
  - "sourcevision"
  - "mcp"
  - "worktree"
blockedBy:
  - "e07c43d4-065b-481d-b996-dad39da83d26"
source: "ndx-capture"
acceptanceCriteria:
  - "A session in worktree B whose sv MCP server started with cwd = main checkout A reads B's .sourcevision/ (get_overview, get_zone, get_findings…) and set_file_archetype writes B's .sourcevision/, not A's."
  - "Uses the @n-dx/llm-client resolveWorkspaceFromRoots helper from the rex task with marker '.sourcevision'; no logic is duplicated and no rex import is added."
  - "A same-repo worktree root without .sourcevision/ refuses set_file_archetype with a message naming both paths; reads fall back to the startup dir with a warning."
  - "Clients without roots, explicit absolute dirs, and the web HTTP factory (packages/web/src/server/domain-gateway.ts → createSourcevisionMcpServer) behave as today."
  - "An integration test spawns the real `sv mcp .` with cwd=A and a roots client naming B."
description: "Where: packages/sourcevision/src/cli/mcp.ts. startMcpServer(targetDir) resolves absDir, exits if absDir/.sourcevision is missing, then createSourcevisionMcpServer(absDir). The server's `context` (context.freshData() etc.) captures the dir.\n\nApply the pattern the rex task introduced:\n- stdio-only opt-in;\n- only when the dir is the implicit cwd;\n- resolve on oninitialized and on notifications/roots/list_changed;\n- calls await the first resolution (bounded about 2 s);\n- rebuild the context for the new dir;\n- one stderr line on rebind;\n- `refused` blocks set_file_archetype (the only write).\n\nKeep the existing startup exit when the STARTUP dir has no .sourcevision/: the main checkout normally has one. If the startup dir lacks it but a client root has it, serving the root is acceptable; decide and test that.\n\nIntegration test mirrors the rex one. Use a tmp repo with a minimal .sourcevision/ fixture in both checkouts that differ in content, so the read case can tell which one was served.\n\nChangeset: @n-dx/sourcevision patch."
lastModified: "2026-10-05T16:29:21.635Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
