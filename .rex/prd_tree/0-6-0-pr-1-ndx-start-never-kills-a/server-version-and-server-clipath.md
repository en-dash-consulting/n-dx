---
id: "a1c9febd-2f08-4d83-bdf8-670b57b05bd3"
level: "task"
title: "server.version and server.cliPath assertions are tautological, so a silent \"unknown\" version ships green"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-01"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test asserts server.version equals the version field read from packages/web/package.json, so a readWebVersion() fallback to \"unknown\" fails the suite."
  - "A test sets NDX_CLI_PATH and asserts server.cliPath equals that exact value, and a second asserts the process.argv[1] fallback when neither env var is set — both fail if the env lookups are removed."
  - "Both assertions exist for GET /api/status (routes-status.test.ts) and GET /api/config (config-endpoint.test.ts)."
description: "Found by ndx-adversarial-review of the PR-1 server-info change (commit eec286d4). Severity: medium. Verdict: should-fix — the runtime values are correct today (verified empirically: buildServerInfo loaded from packages/web/dist/server/routes-status.js returns version 0.5.2), so this is missing regression protection rather than a live defect.\n\nFAILURE SCENARIO. readWebVersion() in packages/web/src/server/routes-status.ts:314-329 catches every failure and returns the literal string \"unknown\". The only two tests that touch server.* assert typeof version === 'string' && version.length > 0 (packages/web/tests/unit/server/config-endpoint.test.ts:56-57 and packages/web/tests/unit/server/routes-status.test.ts:80-81), and \"unknown\" satisfies both. Concretely: change the web tsconfig outDir/rootDir so compiled output lands at <pkg>/dist/routes-status.js instead of <pkg>/dist/server/routes-status.js, or bundle the server into a single file the way build.js already bundles the viewer. resolve(thisDir, '../..') then points at packages/ where no package.json exists, the catch fires, and every GET /api/status and GET /api/config reports server.version: \"unknown\" — the PR-7 footer (item 9cb2fa5b) renders 'n-dx unknown' — while all 225 web test files stay green.\n\nSame shape for cliPath: the trailing ?? '' in buildServerInfo (routes-status.ts:336) guarantees a string, so expect(typeof cliPath).toBe('string') cannot fail even if both env lookups were deleted outright. Two of the six fields the acceptance criteria name are present-but-unverified.\n\nREACHABILITY. Not a runtime path — reached by any future change to the web build layout or to buildServerInfo. No caller-side guard exists: grepping the suite, these two files are the only tests that reference server.*.\n\nSOLUTION OPTIONS. (1) Recommended, cheap: in both tests assert the exact value — read packages/web/package.json in the test and expect(server.version).toBe(pkg.version), and set/delete NDX_CLI_PATH around the request to assert the exact cliPath resolved from it and the argv[1] fallback. Cost: ~15 lines across two files. Risk: none. (2) Make readWebVersion() throw instead of returning 'unknown', so a broken layout fails loudly at boot. Cost: turns a cosmetic degradation into a startup crash; rejected as disproportionate. (3) Leave as-is and rely on the PR-7 footer work to notice. Rejected: the footer item's own AC only covers rendering with and without the server object, not the value."
lastModified: "2026-09-11T01:24:48.884Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
