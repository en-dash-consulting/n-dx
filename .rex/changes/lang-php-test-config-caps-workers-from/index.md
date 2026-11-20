---
id: "9e063540-8e69-4e41-9581-c7bb15663684"
type: "change"
title: "lang-php test config caps workers from NDX_TEST_MAX_WORKERS"
slug: "lang-php-test-config-caps-workers-from"
summary: "The PHP pack's test setup ignores the shared limit on parallel test workers, which fails a repository policy check in CI on every PHP pull request. Following the shared setting fixes that check."
intent: "Found while restacking the PHP PR stack onto main (2026-11-17). `tests/e2e/vitest-max-workers-policy.test.js` requires every vitest config to set `test.maxWorkers: testMaxWorkers()` from `tests/test-max-workers.mjs`. `packages/lang-php/vitest.config.ts`, added in PR 2 by the scaffold task (aac5fad8), does not, so the policy test fails on PR 2 and every PR above it (seen in CI on #1075 and #1083). The sibling `packages/lang-python/vitest.config.ts` shows the expected form."
acceptanceCriteria:
  - "packages/lang-php/vitest.config.ts sets test.maxWorkers from testMaxWorkers() the way lang-python's config does"
  - "tests/e2e/vitest-max-workers-policy.test.js passes"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"fd04acac-099e-4ea0-8364-84298a85678a"}
tags:
  - "lang-php"
  - "ci"
  - "php-pr2"
---
