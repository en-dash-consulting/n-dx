---
id: "e54ea948-bd6e-465c-9b6f-3bd8e10564b3"
type: "task"
title: "Set maxWorkers from testMaxWorkers() in packages/lang-php/vitest.config.ts"
slug: "set-maxworkers-from-testmaxworkers-in"
summary: "Makes the PHP pack's tests follow the shared limit on parallel test workers, so the repository's policy check passes."
description: "In `packages/lang-php/vitest.config.ts`, import `testMaxWorkers` from `../../tests/test-max-workers.mjs` and set `maxWorkers: testMaxWorkers()` as the first key of `test`, with the same one-line comment `packages/lang-python/vitest.config.ts` carries (\"NDX_TEST_MAX_WORKERS caps workers for every project; unset keeps vitest's default.\"). Nothing else changes. Verify with `npx vitest run tests/e2e/vitest-max-workers-policy.test.js` from the repository root and the lang-php suite (`cd packages/lang-php && npx vitest run`). Patch changeset for @n-dx/lang-php is not needed (test config only, not published behaviour); do not add one."
acceptanceCriteria:
  - "packages/lang-php/vitest.config.ts sets test.maxWorkers: testMaxWorkers() imported from tests/test-max-workers.mjs"
  - "tests/e2e/vitest-max-workers-policy.test.js and the lang-php suite pass"
priority: "high"
run: {"tier":"light","review":false,"skipTestGate":true}
---
