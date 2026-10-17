---
id: "94d67abb-01f8-4f16-9e92-6fc66eb51d1b"
level: "task"
title: "web and graview vitest load sourcevision source but resolve @n-dx/lang-kit to its built dist"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pr-11"
source: "ndx-adversarial-review"
startedAt: "2026-10-13T04:01:20.891Z"
completedAt: "2026-10-13T04:01:20.891Z"
endedAt: "2026-10-13T04:01:20.891Z"
resolutionType: "code-change"
resolutionDetail: "Option (a): web and graview vitest configs alias @n-dx/lang-kit to packages/lang-kit/src/index.ts (3c443c3d9). It was the cause of run e70597e0's gate failure, not only a stale-dist risk."
acceptanceCriteria:
  - "packages/web/vitest.config.ts and packages/graview/vitest.config.ts map @n-dx/lang-kit to packages/lang-kit/src/index.ts"
  - "With packages/lang-kit/dist removed, `pnpm --filter @n-dx/web exec vitest run` on a test that reaches sourcevision's language detection resolves lang-kit and passes"
description: "Found by ndx-adversarial-review of b4bb436a (run e70597e0). Verdict: should-fix, low.\n\nScenario: packages/web/vitest.config.ts:19-21 and packages/graview/vitest.config.ts:16-17 alias @n-dx/sourcevision (and llm-client) to source, so their tests run sourcevision's src. Since b4bb436a, that src imports @n-dx/lang-kit, which neither config aliases, so it resolves through sourcevision/node_modules to packages/lang-kit/dist/index.js. Two consequences: (1) after editing packages/lang-kit/src without rebuilding, web and graview tests exercise the stale lang-kit dist while sourcevision's own tests (aliased to lang-kit src in packages/sourcevision/vitest.config.ts) exercise the new source — the two can disagree; (2) in a fresh worktree where lang-kit is unbuilt, web and graview tests that reach sourcevision fail on module resolution, unlike llm-client which is aliased.\n\nReachability: package test runs of web or graview (pnpm --filter @n-dx/web test) after a lang-kit source edit. Partly covered: scripts/run-all-tests.mjs stale-dist detection and hench's gate rebuild changed packages, and CI builds first — so this bites direct package runs, not the gate.\n\nOptions: (a, recommended) add `{ find: /^@n-dx\\/lang-kit$/, replacement: <lang-kit>/src/index.ts }` to web and graview vitest configs, matching sourcevision's — one line each, no runtime effect. Note the lang-kit feature's rule \"do not touch web source\": a vitest config is test setup, not src, but confirm with the operator. (b) leave as is and rely on stale-dist rebuilds."
lastModified: "2026-10-13T04:01:22.037Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
