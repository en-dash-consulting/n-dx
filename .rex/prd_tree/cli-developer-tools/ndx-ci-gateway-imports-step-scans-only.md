---
id: "4fd16cf1-6586-4904-b86b-20b014162859"
level: "task"
title: "ndx ci gateway-imports step scans only .ts files, so a .js or .mjs file that bypasses a gateway passes"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "ndx ci gateway-imports reports a packages/hench/src .mjs or .js file importing @n-dx/rex outside src/prd/rex-gateway.ts as a violation"
  - "A test in tests/e2e/cli-ci.test.js covers a non-.ts file in a gated consumer"
description: "Verdict: out-of-scope (pre-existing), low. Found by the adversarial review of task 4191f655 (run 74104ab6).\n\nFailure scenario: packages/hench/src/x.mjs containing `import { y } from \"@n-dx/rex\"` or `await import(\"@n-dx/rex\")`. tests/e2e/domain-isolation.test.js walk() scans /\\.(ts|js|mjs)$/ and fails it. packages/core/ci.js collectTsFiles (~line 890) collects only .ts, so `ndx ci` gateway-imports reports clean. gateway-rules.json says both paths enforce the same rules.\n\nReachability: future edit only; consumer src dirs are TypeScript today. Covered in-repo by the vitest policy test, not by `ndx ci` alone.\n\nOptions: (a) widen collectTsFiles to .js/.mjs (excluding .d.ts) for the gateway step; check the boundary step's rules still hold on .js. Small. Recommended. (b) Share one scanner module between ci.js and the test. Bigger."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T01:16:39.125Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
