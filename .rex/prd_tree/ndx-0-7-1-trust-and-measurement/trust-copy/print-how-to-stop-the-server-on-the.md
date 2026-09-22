---
id: "a3e76df5-4ac5-459a-b4a2-d84147574fca"
level: "task"
title: "Print how to stop the server on the ndx start success block"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "trust-copy"
  - "wm-2097"
  - "pr-h"
source: "caos work management: WM2097 (Print how to stop the server on the ndx start success block); follow-up from the guards run 2026-09-22, PR group H"
acceptanceCriteria:
  - "The ndx start success output ends with the Stop line naming both commands."
  - "--format=json output, if any, is unchanged."
  - "The e2e test for ndx start output asserts the line."
description: "ndx start now runs the server through the hub daemon and returns immediately, leaving a detached process the operator was never told how to stop. packages/core/web.js (lines 1270 to 1281) prints the registration, the URL, both MCP endpoints and an MCP setup block, then exits 0. Ctrl-C, which the old foreground behaviour trained people to reach for, hits nothing. The stop commands exist (ndx start stop . for this worktree, ndx hub stop for every project) but are documented only under a STOPPING heading in --help, which is read before a command, not after. Add one line to the success block: Stop: ndx start stop .  (or 'ndx hub stop' for every project).\n\nImplementation notes: In packages/core/web.js, in the success block that prints the URL and MCP endpoints (around lines 1270 to 1281), append a final line: 'Stop: ndx start stop .   (or ndx hub stop for every project)'. Update tests/e2e/cli-start.test.js (or cli-start-hub.test.js) to assert it. Orchestration tier: no package imports. Changeset: @n-dx/core patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:47:38.358Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
