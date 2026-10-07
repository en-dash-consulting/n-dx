---
id: "8d41f5a6-4bbd-4962-a00c-b289387137bc"
level: "task"
title: "Rex MCP tool lists in the CLI/UI gap inventory and @n-dx/core README omit claim_task, release_task and get_token_usage"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "docs"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "packages/core/README.md's Rex tool list names all 18 tools registered in packages/rex/src/cli/mcp-tools/registry.ts"
  - "docs/cli-ui-gap.md's Rex MCP tools inventory has a row for claim_task and release_task with a coverage rating, and its heading count equals the row count"
description: "Out-of-scope finding from the adversarial review of task ec5b4506. Pre-existing.\n\nThe rex registry (packages/rex/src/cli/mcp-tools/registry.ts) wires 18 tools. docs/cli-ui-gap.md's \"Rex MCP tools (16)\" inventory has no rows for `claim_task` or `release_task`, so the coverage audit never records whether the dashboard shows claims. packages/core/README.md (the @n-dx/core npm page) lists 15 rex tools, missing `claim_task`, `release_task` and `get_token_usage`.\n\nFailure scenario: a user reading the npm page of @n-dx/core does not learn that worktree claims exist; the coverage inventory reports a complete picture that is missing two write tools.\n\nNot mechanical for cli-ui-gap: each new row needs a coverage judgment (is there a dashboard surface for claims?). The core README edit is mechanical.\n\nRecommended: add the three tools to the core README list; add claim_task/release_task rows to the cli-ui-gap inventory with an honest coverage rating and set the heading count to 18. Optional follow-up: a test asserting each doc's rex tool list equals the registry's tool names."
lastModified: "2026-10-06T07:37:56.318Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
