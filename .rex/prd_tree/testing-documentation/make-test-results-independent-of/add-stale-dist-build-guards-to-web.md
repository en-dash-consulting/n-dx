---
id: "71f1d371-14b9-4999-b640-d33160477e5c"
level: "task"
title: "Add stale-dist build guards to web integration tests that assert on built server output"
status: "pending"
priority: "medium"
tags:
  - "testing"
  - "web"
  - "dx"
  - "review-follow-up"
source: "ndx-capture"
acceptanceCriteria:
  - "port-zero-reporting.test.ts fails fast with an actionable missing-build message (existsSync guard on the built server entry, matching the pattern at scoped-route-dispatch.test.ts:158) when dist/server/start.js has never been built"
  - "A stale build is detected: when the newest packages/web/src/** mtime is newer than dist/server/start.js, the test fails with a message telling the developer to run `pnpm --filter @n-dx/web build`, instead of surfacing as an assertion failure on the behaviour under test"
  - "The staleness guard is implemented once as a shared helper and applied to both port-zero-reporting.test.ts and scoped-route-dispatch.test.ts, not copy-pasted per test"
description: "Review follow-up from the port-zero reporting merge. tests/integration/port-zero-reporting.test.ts claims to use \"the same driver pattern\" as packages/web/tests/integration/scoped-route-dispatch.test.ts, but omits the beforeAll existsSync guard that template has (scoped-route-dispatch.test.ts:158, failing fast on missing SERVER_ENTRY build output).\n\nConsequence observed in re-review: running the test against a dist/ built from the previous head (33d58b9) yields NDX_RESULT={\"port\":60284,\"isFallback\":true,...} and the assertion failure \"port 0 was honoured, so there is no fallback to announce\" (port-zero-reporting.test.ts:146). Because the test asserts on a behaviour change made in the same commit as the test itself, the stale-dist failure mode is guaranteed to present as \"the fix doesn't work\" rather than \"you need to build\" — worse than the prompt-census e2e, which at least says to run pnpm build first. It cost a rebuild cycle to rule out and will cost the next person more, since they won't have a known-good baseline.\n\nTwo levels of fix identified in review:\n1. Minimum: copy the existsSync guard from the sibling test — catches never-built.\n2. Better: compare newest src/** mtime against dist/server/start.js and fail with \"dist is older than src — run pnpm --filter @n-dx/web build\" — catches stale (the mode that actually bit), and should cover scoped-route-dispatch.test.ts too.\n\nSame root cause as the package.json thread on verify — worth solving once for both. Not a blocker: everything is green on head after a rebuild (web 3558 pass / 7 skipped, hench 3281 pass / 11 skipped, tests/e2e + tests/integration 1837 pass / 6 skipped)."
lastModified: "2026-09-11T16:34:44.585Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
