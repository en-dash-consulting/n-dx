---
id: "015a9f0b-46fc-4b8a-96e4-eeb04fc1a7f0"
level: "task"
title: "Implement shared legacy-PRD detection, backup, and migration helper"
status: "in_progress"
priority: "high"
tags:
  - "rex"
  - "migration"
  - "prd"
source: "smart-add"
startedAt: "2026-04-30T16:08:53.868Z"
acceptanceCriteria:
  - "Helper detects .rex/prd.json presence and short-circuits when absent or when a folder-tree already reflects its content"
  - "Backup file is written to .rex/ with a timestamped suffix before any destructive action and is preserved on success and failure"
  - "Existing migrate-to-folder-tree logic is reused — no duplicated parser/serializer code paths"
  - "On success, .rex/prd.json is moved aside (renamed to .rex/prd.json.migrated) so subsequent runs no-op"
  - "On migration failure, the backup remains untouched, prd.json is left in place, and the helper throws a typed error consumable by callers"
  - "Helper uses a file lock or equivalent guard to prevent concurrent invocations from racing on the same project"
description: "Add a single helper (e.g. ensureLegacyPrdMigrated) in the rex package that checks whether .rex/prd.json exists, copies it to a timestamped backup file (e.g. .rex/prd.json.backup-YYYYMMDD-HHMMSS) before any modification, invokes the existing folder-tree migration logic to populate .rex/tree/, and removes or archives the original prd.json only after successful migration. The helper must be idempotent (no-op when prd.json is absent or already migrated) and safe to call from CLI, MCP, and web server entry points without re-running concurrently."
---
