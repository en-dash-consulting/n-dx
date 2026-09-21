---
id: "27de7e14-db19-4fbc-b91d-760e765bb9b4"
level: "task"
title: "Implement `rex tree` / `ndx tree` command that walks prd_tree and prints an indented hierarchy"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "rex"
  - "prd"
source: "smart-add"
startedAt: "2026-05-08T04:39:56.103Z"
completedAt: "2026-05-08T04:46:11.885Z"
endedAt: "2026-05-08T04:46:11.885Z"
resolutionType: "code-change"
resolutionDetail: "Implemented ndx tree handler by adding handleTree function to packages/core/cli.js and registering it in COMMAND_DISPATCH. Updated help.js with command registry entries. Updated CLI contract test to include tree command."
acceptanceCriteria:
  - "`rex tree` and `ndx tree` both execute successfully against a valid `.rex/prd_tree/` directory"
  - "Output indentation reflects the full epic → feature → task hierarchy"
  - "Each node line shows the item title and its status string (completed / in_progress / pending)"
  - "Command exits non-zero with a clear error message if `.rex/prd_tree/` is absent or unreadable"
  - "Title is read from index.md frontmatter `title` field, falling back to the slug directory name"
description: "Add a `rex tree` command (with `ndx tree` orchestrator alias) that reads the `.rex/prd_tree/` folder tree, parses each item's `index.md` frontmatter for title and status, and prints a recursive indented tree. The command must follow the rex CLI two-tier API pattern: domain logic in `packages/rex/src/core/` or a new CLI command file under `packages/rex/src/cli/commands/`, wired into the rex CLI index and the ndx orchestrator spawn table."
---
