---
id: "ddfd38ea-da6d-496a-9218-f9cce00ecd34"
level: "task"
title: "Make ndx claim resolve .rex in the directory it is given"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "pr-e"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "ndx claim list <dir> and ndx claim release <id> <dir> work when run from outside the project."
  - "The init check uses the same directory rex will act on, and ndx stays spawn-only (no package import)."
  - "tests/e2e/cli-arg-contracts.test.js covers the directory argument."
description: "`handleClaim` in `packages/core/cli.js` (near line 1991) calls `requireInit(process.cwd(), [\".rex\"])` before forwarding to `rex claim`. So `ndx claim list <dir>`, run from outside the project or from a subdirectory, fails the init check even though rex itself would resolve the directory.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:40:01.747Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
