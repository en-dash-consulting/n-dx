---
id: "f0f2bab6-1130-4db4-bbce-54e4f8d8615d"
level: "task"
title: "The completion gate and review captures understand v2"
status: "pending"
priority: "critical"
tags:
  - "pr-35"
  - "lane-hench"
  - "hench"
blockedBy:
  - "44043b84-1a8e-4ead-adf7-41d98f338bc2"
startedAt: "2026-10-12T10:42:05.355Z"
acceptanceCriteria:
  - "<rexDir>/product/ and <rexDir>/changes/ (state.yaml included) count as PRD bookkeeping in the uncommitted-work gate, the changed-file gate and the save-report staging (test)"
  - "The review-capture dedupe step reads changes/, not prd_tree/ (test)"
  - "The agent MCP allowlist adds get_capability and place_change (test)"
description: "The completion gate and review captures understand v2. <rexDir>/product/ and <rexDir>/changes/ (state.yaml files included) count as PRD bookkeeping in the uncommitted-work gate, the changed-file gate and the save-report staging, exactly as prd_tree/ does on v1. The review-capture dedupe step reads changes/ (not prd_tree/) on v2. The agent MCP allowlist (AGENT_REX_MCP_TOOLS, packages/hench/src/process/agent-mcp-config.ts) adds get_capability and place_change; apply_change stays operator-only (from 6daf36b5).\n\nDesign boundary (roadmap PR 35, stack B; every change is checked against it):\n- Lane files: packages/hench (src and tests), plus the two root tests tests/e2e/architecture-policy.test.js (gateway export ceiling, with a \"Raised from X to Y for …\" description entry) and tests/integration/cross-package-contracts.test.js.\n- Not rex and not web. hench consumes rex only through its public API (packages/rex/src/public.ts, as exported by roadmap PR 34 task T6), and only through packages/hench/src/prd/rex-gateway.ts (re-export only, no logic; type imports through the gateway too). If something hench needs is not exported by rex, stop and report it rather than editing rex.\n- v1 trees keep today's behaviour exactly: this repository's own PRD is v1 and hench works on it every day; existing v1 tests pass unedited.\n- On a v2 tree (rex's prdLayout reports \"v2\") hench never writes through a v1 FileStore and never writes prd_tree/.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy it to a temp dir before any test that writes).\n- Add a patch changeset for @n-dx/hench. Never major.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold (resolveStore dispatches on layout; v1 field names kept with optional v2 fields; #648 not merged, so rex exports only what hench and web need). `--epic-by-epic` refuses on v2 rather than mapping epics to changes (the epic level does not exist on v2; mapping is a later decision).\n\nPrevious attempt (run 625287e8, 2026-10-12): the work landed in commit 1d6eb344a, but the test gate failed on one test: packages/hench/tests/unit/agent/claude-cli-adapter.test.ts \"ClaudeCliAdapter: rex MCP write tools > grants exactly the three tools hench's own prompts direct\" still expects exactly update_task_status, append_log and add_item. This task's criterion adds get_capability and place_change by design, so update that test (and its title and comment) to the five tools, keep apply_change excluded, and run the full hench suite before finishing."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:48:44.941Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
