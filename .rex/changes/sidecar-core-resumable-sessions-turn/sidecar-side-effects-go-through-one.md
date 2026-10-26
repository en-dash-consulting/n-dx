---
id: "1042b913-0c63-4f01-9fa7-122a93f2a8eb"
type: "task"
title: "Sidecar side effects go through one broker that raises permission cards"
slug: "sidecar-side-effects-go-through-one"
description: "An ndx-sidecar MCP server owns run_command, start_work, propose_prd_change, place_change_card, propose_edit, github_read, draft_github_post, migration_decision and ledger_append; vendor write tools are off. CAOS story: https://www.notion.so/3f7a80b7192481e0a645e0c1b1b7f2b7."
acceptanceCriteria:
  - "Claude spawns with strict MCP config and Edit/Write/Bash disallowed"
  - "Codex spawns read-only"
  - "each write tool blocks until its card is decided or matches the allow-list"
  - "work, edits, PRD writes, placements, migration decisions and posts can never be allow-listed"
priority: "high"
source: "caos"
---
