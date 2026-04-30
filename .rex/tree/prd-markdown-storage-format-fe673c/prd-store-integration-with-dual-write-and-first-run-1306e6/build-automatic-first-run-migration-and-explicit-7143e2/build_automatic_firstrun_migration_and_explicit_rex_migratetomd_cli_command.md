---
id: "7143e2a0-7c77-45ed-b3e5-d588a11b3b27"
level: "task"
title: "Build automatic first-run migration and explicit rex migrate-to-md CLI command"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "migration"
  - "storage"
source: "smart-add"
startedAt: "2026-04-24T15:55:40.852Z"
completedAt: "2026-04-24T16:05:53.263Z"
acceptanceCriteria:
  - "Automatic migration fires in PRDStore.load() when .rex/prd.md is absent and .rex/prd.json is present, producing .rex/prd.md"
  - "`rex migrate-to-md` command exists, is documented in `rex --help`, and produces .rex/prd.md from .rex/prd.json"
  - "Migration output passes the round-trip fidelity test: parse(migrate(prd.json)) deep-equals the original in-memory tree"
  - "All fields are preserved including timestamps, token usage, duration, and completed/in_progress status"
  - "Original .rex/prd.json is NOT deleted or modified by either migration path"
  - "Migration emits a clear success message including the output path; errors surface as typed failures with actionable messages"
description: "Implement a migration that runs automatically in PRDStore.load() the first time a project is opened after the update (prd.md absent, prd.json present) and converts the existing JSON PRD to markdown. Expose the same logic as an explicit `rex migrate-to-md` CLI command for manual invocation. The original prd.json must not be modified. No data loss is acceptable."
---
