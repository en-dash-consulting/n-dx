---
id: "6202f721-ef9f-4552-82a7-dc7265831bf9"
level: "task"
title: "Delete the rex tracker adapters, rex sync, rex adapter and the sync_with_remote tool"
status: "pending"
priority: "medium"
tags:
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
source: "roadmap"
acceptanceCriteria:
  - "No adapter for an external tracker remains in rex/src/store"
  - "rex sync, rex adapter and sync_with_remote no longer exist and their help text is gone"
  - "file-adapter.ts and its callers are unchanged and their tests pass"
description: "Remove notion-adapter, notion-client, notion-map, jira-*, asana-*, github-projects-* and integration-schemas under rex/src/store, the sync engine if only they use it, the sync and adapter CLI commands, and the sync_with_remote MCP tool module. Move any helper still needed (redaction, env resolution) to a neutral module first."
lastModified: "2026-10-06T04:16:39.570Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
