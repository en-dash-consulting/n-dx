---
id: "93517780-f058-4e22-b52b-7bbba2c45c2d"
type: "task"
title: "Implement rex migrate-to-folder-tree command and auto-trigger detection"
slug: "implement-rex-migrate-to-folder-tree"
description: "Build a one-shot CLI command (rex migrate-to-folder-tree) that reads the existing prd.md, runs the serializer, and writes the full folder tree to .rex/prd/. Auto-trigger this migration transparently the first time any read or write command runs and detects prd.md without a prd/ folder. The command must be idempotent and print a creation summary."
acceptanceCriteria:
  - "Running the command on an existing prd.md produces a complete folder tree with zero data loss"
  - "Command is idempotent: re-running on an already-migrated repo updates changed items without duplicating folders"
  - "Command prints a creation summary: N folders created, M index.md files written"
  - "Auto-trigger fires transparently on first read/write when prd/ is absent but prd.md exists, printing a one-line migration notice"
  - "ndx init scaffolds .rex/prd/ and writes a root index.md stub on new projects"
priority: "high"
tags:
  - "prd"
  - "migration"
  - "cli"
  - "init"
source: "smart-add"
---
