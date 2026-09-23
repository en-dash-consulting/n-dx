---
id: "77a603ad-c2b9-4283-9724-0deb0e50fea0"
level: "task"
title: "Stage and discount the same PRD paths so a tracked execution log does not dirty the tree after every completion"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "pr-c"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "One definition decides which PRD paths the completion commit stages and which the uncommitted-work gate discounts; a unit test fails if they diverge."
  - "Integration test: in a project that tracks .rex/execution-log.jsonl, a completed task leaves the working tree clean, or the log is reported to the operator as theirs to commit; it is never silently left dirty."
  - "A gitignored execution log is still neither staged nor reported (WM2084 behaviour preserved)."
description: "PR K (#388, WM2084) took the execution log off the completion commit's staging list, but `PRD_COMMIT_PATHS` in `packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts:55-60` still lists it, so the completion gate discounts a file the commit never stages. In a project that tracks `.rex/execution-log.jsonl` (one created before rex init gitignored it), the log stays modified after every completion and the next autonomous invocation's pre-run gate refuses to start. The comment at `shared.ts:1560-1564` says the staged set must equal the discounted set; it no longer does.\n\nWM2040 (stage only the files the serializer wrote) replaces the staging set in the same PR; make the discounted set come from the same source so the two cannot drift again.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:39:37.099Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
