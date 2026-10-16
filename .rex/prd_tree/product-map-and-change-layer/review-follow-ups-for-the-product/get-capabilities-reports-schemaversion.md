---
id: "4967ee91-e741-41b0-9ae9-d9d55e3f597a"
level: "task"
title: "get_capabilities reports schemaVersion rex/v1 on a v2 tree"
status: "pending"
priority: "medium"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
  - "v2-migrate-l7"
source: "rehearsal gate item 6/7, fresh session 2026-10-16"
acceptanceCriteria:
  - "get_capabilities on a v2 tree reports schemaVersion rex/v2 (or names the layout explicitly), and on a v1 tree rex/v1 (test)"
  - "The release note names the changed value"
description: "Found by rehearsal gate items 6 and 7 (fresh Claude Code session in a rules-only migrated copy of this repository at the L6 tip 40ff3efd2, 2026-10-16; report in the workshop status.md). Not a cut blocker: every MCP write and both skills worked. get_capabilities answers \"schemaVersion\": \"rex/v1\" beside \"adapter\": \"v2-change-layer\". A client that reads schemaVersion takes the tree for v1; the rehearsal session's first attempt stopped on exactly this. Soft freeze: an MCP field's value changes, so it needs a release-note line."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:26.851Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
