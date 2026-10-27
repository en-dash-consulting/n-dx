---
id: "0f659c06-3f19-4957-88eb-a72ccaaff145"
type: "change"
title: "Implement migration command to rename legacy index.md files to title-based names"
slug: "implement-migration-command-to-rename"
intent: "Add a `rex migrate-folder-tree-filenames` command (or extend the existing `rex migrate-to-folder-tree`) that walks `.rex/tree/`, renames each item's `index.md` to its title-based filename, and reserves `index.md` for the new folder-summary role. The migration must be idempotent, must detect filename collisions across siblings, and must log every rename for audit. Auto-trigger detection should run the migration on first read after upgrade."
acceptanceCriteria:
  - "CLI command renames all legacy `index.md` files under `.rex/tree/` to their title-based filenames"
  - "Idempotent: re-running the command after success is a no-op"
  - "Detects sibling filename collisions and either reports them or appends a stable disambiguator (e.g., short id suffix)"
  - "Auto-trigger: PRDStore detects legacy layout on first read and runs migration before parsing"
  - "Migration logs each rename to `.rex/execution-log.jsonl`"
  - "End-to-end test migrates a fixture tree containing nested epics/features/tasks and verifies post-migration state"
amends: [{"target":"1797eb3e-8ef9-4148-80fe-966693dd4e97","delta":"modified","summary":"Implement migration command to rename legacy index.md files to title-based names","base":"3eff1277f48bb8f92522aba77e891fc515d81b0d7def896e35d21203e3434241"}]
priority: "high"
tags:
  - "rex"
  - "migration"
  - "prd"
source: "smart-add"
---
