---
id: "a6832dea-5745-45eb-b651-69eaa0b08c47"
level: "task"
title: "sv get_overview reports the project name, not the full path, on Windows"
status: "completed"
priority: "critical"
tags:
  - "sourcevision"
  - "mcp"
  - "windows"
  - "ci"
source: "ndx-capture"
startedAt: "2026-10-05T21:03:33.335Z"
completedAt: "2026-10-05T21:16:45.371Z"
endedAt: "2026-10-05T21:16:45.371Z"
acceptanceCriteria:
  - "get_overview's `project` is the last path segment of manifest.targetPath for both POSIX ('/a/b') and Windows ('C:\\\\x\\\\b') paths."
  - "A unit test exercises a Windows-style targetPath and runs on any OS, so it does not depend on node:path's platform behaviour."
  - "packages/sourcevision/tests/integration/mcp-client-roots.test.ts is unchanged and still passes, with its `project: 'a' | 'b'` assertions intact."
  - "`pnpm test` passes."
description: "PR en-dash-consulting/n-dx#520 CI: the 'CLI Smoke (Windows)' leg (run 37369871845, job 111964079930) failed 3 tests in packages/sourcevision/tests/integration/mcp-client-roots.test.ts.\nEach failure has the correct `files` count, so the roots routing is right. Only `project` is wrong: expected 'b', received 'C:\\\\Users\\\\runneradmin\\\\AppData\\\\Local\\\\Temp\\\\sv-mcp-roots-O8tHBC\\\\b'.\n\nCause: this bug is already on main and the new test exposed it. packages/sourcevision/src/cli/mcp.ts (the get_overview tool, around line 230) computes `project: data.manifest.targetPath.split(\"/\").pop()`, and on Windows targetPath uses backslashes.\n\nFix: take the last segment on either separator, e.g. `targetPath.split(/[\\\\/]/).filter(Boolean).pop()`, the same approach as `basenameOf` in packages/core/mcp-shim.js. Do not use node:path `basename`: on POSIX it would not split a Windows path, so a unit test could not cover the Windows case. Add a unit test next to the existing sv MCP unit tests (find them under packages/sourcevision/tests/unit/cli/) with a Windows-style targetPath. Do not loosen the integration test.\n\nOut of scope (leave as is): the same `targetPath.split(\"/\").pop()` pattern in src/analyzers/context.ts, src/analyzers/llms-txt.ts and src/export/pdf-report.ts. Those affect generated files, not this PR's MCP work, and are tracked in en-dash-consulting/n-dx#522.\n\nCommands: use exactly these forms, which are on the permission allowlist. `pnpm run …`, `npx tsc` and `pnpm exec tsc` stall the run on an approval prompt.\n- `pnpm --filter @n-dx/sourcevision build`\n- `pnpm --filter @n-dx/sourcevision exec vitest run <test file>`\n- `pnpm --filter @n-dx/sourcevision typecheck`\n- `pnpm test` before done.\n\nChangeset: add `@n-dx/sourcevision` patch, or extend .changeset/sv-mcp-client-roots.md with one sentence about the Windows project name."
lastModified: "2026-10-05T21:16:45.783Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
