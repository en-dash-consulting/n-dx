---
id: "36e9ac1d-dcf7-4fee-a925-03019608c7e7"
level: "task"
title: "rex health never passes the project's releases to the v2 rules, so title-release-token cannot fire"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T08:31:50.197Z"
completedAt: "2026-10-09T08:38:35.119Z"
endedAt: "2026-10-09T08:38:35.119Z"
resolutionType: "code-change"
resolutionDetail: "Run fbaa567d (claude-sonnet-5-5, review claude-opus-5-5), commit(s) b05a65995; stale dist only; gate re-run green after rebuild (node scripts/run-all-tests.mjs affected 6452cd64d, 4/4 suites passed). Closed by the overnight Lane A session."
acceptanceCriteria:
  - "rex health on a v2 tree with a change titled with one of its own plannedRelease values reports title-release-token (test)"
  - "A title naming a dependency version that is not a project release is not flagged by rex health (test)"
description: "Verdict: should-fix (low).\n\nScenario: on a v2 tree, a change titled \"0.9.0 release audit\" with plannedRelease \"0.9.0\" gets no title-release-token finding from `rex health`. checkV2TreeHealth (packages/rex/src/core/health.ts) calls checkV2Rules without `releases`. Per decision 6ae69b1a, the rule flags a version token only when it names a release in RuleOptions.releases, and when that list is empty it flags nothing. No caller in packages/rex/src fills `releases`: change-add, change-place, apply-amendments and prd-bundle-v2 all omit it. `rex health` is the first caller that runs the whole tree, so it is where the rule was expected to be live.\n\nFix: collect the releases (the package version line, plus every plannedRelease and shippedIn in the tree) in one helper in core, and pass them from checkV2TreeHealth. Cost: small. Whether the write paths (change-add, change-place) should pass them too is a separate decision for the owner.\n\nScope (overnight 2026-10-09): rex health only. Add the releases helper in core and pass it from checkV2TreeHealth. Leave change-add, change-place, apply-amendments and prd-bundle-v2 unchanged; whether the write paths pass releases is Ryan's separate decision. Add a positive test too (a v2 change titled with a project release token is flagged) beside the negative one in the acceptance criteria. If cli/commands imports anything new from ../../store, import it through ../../store/index.js (domain-layer-boundary test)."
lastModified: "2026-10-09T08:38:35.390Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
