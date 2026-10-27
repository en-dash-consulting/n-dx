---
id: "27de7e14-db19-4fbc-b91d-760e765bb9b4"
type: "change"
title: "Implement `rex tree` / `ndx tree` command that walks prd_tree and prints an indented hierarchy"
slug: "implement-rex-tree-ndx-tree-command"
intent: "Add a `rex tree` command (with `ndx tree` orchestrator alias) that reads the `.rex/prd_tree/` folder tree, parses each item's `index.md` frontmatter for title and status, and prints a recursive indented tree. The command must follow the rex CLI two-tier API pattern: domain logic in `packages/rex/src/core/` or a new CLI command file under `packages/rex/src/cli/commands/`, wired into the rex CLI index and the ndx orchestrator spawn table."
acceptanceCriteria:
  - "`rex tree` and `ndx tree` both execute successfully against a valid `.rex/prd_tree/` directory"
  - "Output indentation reflects the full epic → feature → task hierarchy"
  - "Each node line shows the item title and its status string (completed / in_progress / pending)"
  - "Command exits non-zero with a clear error message if `.rex/prd_tree/` is absent or unreadable"
  - "Title is read from index.md frontmatter `title` field, falling back to the slug directory name"
amends: [{"target":"13d17a1e-7203-4afd-b082-64b32742dead","delta":"modified","summary":"Implement `rex tree` / `ndx tree` command that walks prd_tree and prints an indented hierarchy","base":"08c974d454a7e5e0abc8da98dec145fe2d75e97d1c97d26de1398735a5ae0635"}]
priority: "high"
tags:
  - "cli"
  - "rex"
  - "prd"
source: "smart-add"
---
