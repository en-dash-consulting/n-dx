---
id: "efc7dfe8-6d04-44b7-8eb2-beb9111fafad"
level: "task"
title: "Display target PRD path in ndx add command output"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "ux"
source: "smart-add"
startedAt: "2026-04-27T03:23:33.524Z"
completedAt: "2026-04-27T03:46:02.093Z"
resolutionType: "code-change"
resolutionDetail: "Added prdPath display to cmdAdd and cmdSmartAdd. Text output prints `Added to: .rex/prd.md` (or branch-scoped `.rex/prd_{branch}_{date}.md`) before the summary; JSON output includes `prdPath` (string) for cmdAdd and `prdPaths` (array) for smart-add accept. Path is resolved from FileStore.getItemFileMap() so child items routed to a parent's owning branch file are reported correctly. Shared toMarkdownSourcePath helper added to prd-md-migration.ts and re-exported from store/index.ts. Added unit test for canonical (.rex/prd.md) and integration test for branch-scoped scenarios in add.test.ts and branch-scoped-add.test.ts; both verify text output ordering and JSON prdPath field."
acceptanceCriteria:
  - "Human-readable ndx add output includes a line like 'Added to: .rex/prd.md' identifying the target PRD file"
  - "JSON output mode includes a 'prdPath' field with the absolute or repo-relative path of the target PRD file"
  - "Branch-scoped writes show the correct branch-scoped filename when multi-file mode is active"
  - "Output is shown for both single-task and bulk (--file) add invocations"
  - "Unit or integration test verifies the path appears in stdout for at least one canonical and one branch-scoped scenario"
description: "When ndx add (and rex add) creates new items, print the resolved PRD file path the items were written to (e.g. .rex/prd.md or a branch-scoped .rex/prd_{branch}_{date}.md). The message should appear after successful write, before the summary of created items, and should respect --json output mode by including a prdPath field in the JSON payload."
---
