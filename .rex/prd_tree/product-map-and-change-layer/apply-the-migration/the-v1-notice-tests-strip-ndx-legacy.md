---
id: "6ffeb488-1333-4749-bb7f-b42e5323e4c8"
level: "task"
title: "The v1 notice tests strip NDX_LEGACY_NOTICE from the environment they spawn with"
status: "pending"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
source: "review-2026-10-12"
acceptanceCriteria:
  - "packages/rex/tests/e2e/cli-legacy-layout-notice.test.ts passes with NDX_LEGACY_NOTICE=off exported (fails at a7f2c007da: 3 of 6)"
  - "tests/e2e/cli-legacy-notice-once.test.js passes with NDX_LEGACY_NOTICE=off exported"
  - "Both files still pass without the variable set"
description: "Review of #691 (2026-10-12), should-fix, CONFIRMED (lead reviewer reproduced: NDX_LEGACY_NOTICE=off npx vitest run tests/e2e/cli-legacy-layout-notice.test.ts in packages/rex fails 3 of 6; without it 6 of 6 pass). packages/rex/tests/e2e/cli-legacy-layout-notice.test.ts:19-22 (and :69) and tests/e2e/cli-legacy-notice-once.test.js:16-25 spawn with the inherited environment. noteLegacyLayoutOnce (packages/core/cli.js:541) sets NDX_LEGACY_NOTICE=off for 'ndx work' on a v1 tree, and this repository is v1, so the value flows into hench and its test gate (execShellCmd passes no env).\n\nFailure scenario: any ndx work task whose gate selects these files fails: 'works and prints the notice once', 'keeps --format=json…' and 'finds the project when the last positional is an id' assert a count of 1 and get 0; the root 'ndx ci/status prints it exactly once' tests fail the same way through the early return at cli.js:538.\n\nFix: delete NDX_LEGACY_NOTICE from the spawned env in both helpers, as tests/unit/migrate-chain.test.js:46 already does."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:16:05.697Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
