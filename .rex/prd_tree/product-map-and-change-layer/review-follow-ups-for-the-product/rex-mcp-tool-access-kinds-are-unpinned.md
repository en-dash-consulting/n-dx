---
id: "b05a6673-1f0b-488d-8282-ca360db2e6a7"
level: "task"
title: "Rex MCP tool access kinds are unpinned, so a write tool can flip to read and escape #499 write refusal"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "mcp"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test fails if any rex MCP write tool (add_item, edit_item, update_task_status, move_item, append_log, claim_task, release_task, sync_with_remote) declares access \"read\""
  - "A test fails if merge_items reports \"write\" for preview: true or \"read\" for a non-preview call"
  - "A test fails if reorganize reports \"read\" when accept is set or \"write\" when it is not"
  - "A test fails if any read-only tool (get_prd_status, get_next_task, get_item, get_recommendations, verify_criteria, health, facets, get_token_usage, get_capabilities) declares access \"write\""
  - "Adding a tool to REX_MCP_TOOLS without an expected access entry fails the test"
description: "Found by an adversarial review of the per-tool MCP split (roadmap PR 2). Verdict: should-fix — no current defect, but the split makes it easy to introduce one.\n\nFailure scenario: a later roadmap PR edits one tool module, say packages/rex/src/cli/mcp-tools/update-task-status.ts, and changes `access: \"write\"` to `\"read\"` (or breaks an argument-dependent rule such as merge-items.ts `args.preview ? \"read\" : \"write\"` or reorganize.ts `args.accept ? \"write\" : \"read\"`). Typecheck, the tools/list snapshot and every suite stay green, because access is not in the tools/list response. A Claude desktop worktree session whose MCP root cannot be served (workspace.refused set) then calls that tool, and withWorkspace in packages/rex/src/cli/mcp.ts lets it through: the write lands in the startup checkout's .rex/prd_tree — the #499 wrong-PRD write the refusal exists to prevent.\n\nEvidence: the access kind is decided per tool in packages/rex/src/cli/mcp-tools/<tool>.ts and enforced in mcp.ts withWorkspace (`ws.refused && kind === \"write\"`). The only test of refusal is packages/rex/tests/integration/mcp-client-roots.test.ts:206, which exercises add_item alone. The #499 hotfix (epic 4aae158d, completed) specified the full list, but tests never pinned it: writes are add_item, edit_item, update_task_status, move_item, merge_items (unless preview), append_log, claim_task, release_task, sync_with_remote, reorganize (when accept is set); everything else reads. The review verified by hand that all 19 tools match that list today.\n\nReachability: any MCP write tool, from a stdio rex server following client roots whose root is refused. Not covered: the snapshot cannot see access, and no other test does.\n\nWhy now: before the split, all 19 access kinds sat together in mcp.ts; now each sits in its own module, and the point of the split is that roadmap PRs edit those modules independently. In scope for the split feature, though the coverage gap itself predates it.\n\nOptions:\n1. (Recommended) A unit test that iterates REX_MCP_TOOLS and asserts each tool's access kind against an explicit expected table, evaluating the argument-dependent ones on both branches (merge_items preview true/false, reorganize accept set/unset). Cost: one small test, no production change. Risk: none; a new tool must add a table row, which is the point.\n2. An integration test that builds a refused workspace and calls every write tool, asserting isError. Stronger end-to-end, but slower and needs the git-worktree fixture from mcp-client-roots.test.ts. Worth it only if option 1 is judged too far from the enforcement point.\n3. Fold access into the tools/list snapshot by snapshotting a derived {name, access} list beside it. Cheap, but a snapshot is regenerated with -u, which is exactly when a reviewer stops reading the diff — a hand-written expected table is the more deliberate guard."
lastModified: "2026-10-06T05:30:10.757Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
