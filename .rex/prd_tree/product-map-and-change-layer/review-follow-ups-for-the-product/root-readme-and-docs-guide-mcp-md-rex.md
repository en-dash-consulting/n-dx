---
id: "0ff2ba8c-0a08-4172-b27b-06c885f0944f"
level: "task"
title: "Root README and docs/guide/mcp.md Rex MCP tool lists omit get_token_usage, and no test ties doc lists to the registry"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "docs"
  - "rex"
  - "pr-24"
  - "lane-core-docs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "README.md's Rex MCP tool list names get_token_usage"
  - "docs/guide/mcp.md's Rex MCP Tools table has a get_token_usage row"
  - "A test fails when a rex registry tool (excluding the v2 tools named in an explicit allowlist) is missing from README.md, packages/core/README.md, packages/rex/README.md, docs/guide/mcp.md or docs/cli-ui-gap.md"
description: "Out-of-scope finding from the adversarial review of task 8d41f5a6, which added the missing v1 tools to packages/core/README.md and docs/cli-ui-gap.md. The defect is pre-existing.\n\nFailure scenario: a user reading README.md:351 (the root README and npm landing page) or docs/guide/mcp.md:81-101 (the docs site's Rex MCP Tools table) does not learn that `get_token_usage` exists. packages/rex/README.md:284 and packages/core/README.md already list it. Nothing ties these lists to packages/rex/src/cli/mcp-tools/registry.ts, so each new tool drifts out of some lists, as claim_task and release_task did before 8d41f5a6.\n\nReachability: documentation that users read directly. No runtime impact.\n\nOptions:\n(a) Add `get_token_usage` to both lists. Cheap and mechanical, but the lists will drift again.\n(b) Do (a), and add a root-drift test asserting that each doc's v1 rex tool list equals the registry's v1 tool names. The test must allow for the v2 tools (get_product, get_capability, place_change, apply_change), which the D2 decision assigns to the v2 package pages in PR 28. Costs one test file plus a ROOT_DRIFT_TEST_FILES entry. Risk: the v1/v2 split needs an explicit allowlist.\n\nRecommended: (b). Verdict: out-of-scope (pre-existing) and worth a follow-up."
lastModified: "2026-10-10T19:35:41.707Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
