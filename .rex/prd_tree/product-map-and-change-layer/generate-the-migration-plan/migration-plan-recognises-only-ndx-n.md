---
id: "8443a9e1-c325-4d3c-bfc1-63aae28177f3"
level: "task"
title: "Migration plan recognises only \"ndx\"/\"n-dx\" as a product name, so another repository's \"Acme 2.0\" release epic becomes an area"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "classifyV1Tree(items, { productNames: [\"acme\"] }) classifies an epic titled \"Acme 2.0\" as a release with plannedRelease \"2.0\" (test)"
  - "Without options, \"ndx 0.9.0\", \"0.6.0 / PR 4 · …\" and \"Release v1.2\" still classify as release or change, and \"Python 3.12 support\" stays an area (test)"
  - "A product name containing regex metacharacters (e.g. \"c++\") is escaped and does not throw (test)"
description: "Verdict: should-fix (medium).\n\nScenario: in packages/rex/src/migrations/v1-to-v2/migration-plan.ts, RELEASE_TOKEN (around line 97) now counts a dotted version only at the start of the title, after `v`, after `release(s)`, or after the hard-coded product names `ndx` and `n-dx`. In any other repository, a v1 release epic titled \"Acme 2.0\" or \"MyApp 2.0 launch\" yields releaseToken === undefined. The epic becomes a standing area, and its children become capabilities instead of changes with plannedRelease \"2.0\". Before a646fc0a these were classified as releases. Nothing in the plan flags the change.\n\nReachability: classifyV1Tree, on any non-ndx repository whose release epics name the product. The command isn't wired yet (task 27e4f378). classifyV1Tree(items) takes no options, so a caller cannot supply the product name.\n\nOptions:\n(a) Recommended: add an options argument to classifyV1Tree, e.g. `{ productNames?: string[] }`, defaulting to [\"ndx\", \"n-dx\"]. Build the release regex from those names, regex-escaped. The call site passes the package.json name (the unscoped part) and the project directory name. Cost: small; one extra regex constructor and tests. Risk: a low-quality name (e.g. a one-letter repo name) widens matching.\n(b) Derive the names inside the plan from the v1 PRD title. No I/O is needed, but PRD titles are often not the product name.\n\nRelated low-severity finding, dropped in review: \"Python v3.12 support\" still reads as a release, because a bare `v` prefix counts anywhere in the title. Option (a) could also restrict a mid-title `v` to follow a product name.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-08T21:40:53.868Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
