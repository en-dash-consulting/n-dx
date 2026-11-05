---
id: "1042b913-0c63-4f01-9fa7-122a93f2a8eb"
type: "task"
title: "Sidecar side effects go through one broker that raises permission cards"
slug: "sidecar-side-effects-go-through-one"
description: "An ndx-sidecar MCP server owns run_command, start_work, propose_prd_change, place_change_card, propose_edit, github_read, draft_github_post, migration_decision and ledger_append; vendor write tools are off. CAOS story: https://www.notion.so/3f7a80b7192481e0a645e0c1b1b7f2b7."
acceptanceCriteria:
  - "Claude spawns with the read-only built-in allowlist --tools Read,Grep,Glob, --strict-mcp-config naming only the ndx-sidecar broker, --allowed-tools mcp__ndx-sidecar, and no settings sources that can carry permissions.allow rules; a test asserts the argv"
  - "Codex spawns read-only"
  - "each broker write tool blocks until its card is decided or matches the Sidecar allow-list, and the operator's own permissions.allow rules never decide a call"
  - "work, edits, PRD writes, placements, migration decisions and posts can never be allow-listed"
  - "llm-client's ClaudeTurnFlags gains tools and settingSources, and the Sidecar session sets them"
priority: "high"
source: "caos"
---
