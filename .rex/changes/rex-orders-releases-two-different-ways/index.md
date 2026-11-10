---
id: "b91f73b4-f77d-4c58-b9a2-501e125aeffb"
type: "change"
title: "rex orders releases two different ways: stale-release-plan ignores the pkg@x.y.z names the selector accepts"
slug: "rex-orders-releases-two-different-ways"
intent: "Verdict: should-fix (low), from the adversarial review of task 9156347e (stale-release-plan rule).\n\nrex now has two release comparators. core/change-selection.ts compareReleases (the nearest-plannedRelease ordering) strips a `pkg@` prefix and accepts non-semver dotted names. schema/v2-rules.ts compareReleases/parseRelease (the stale-release-plan rule, added in 6b49a385b) accepts strict semver only. A third copy lives in web viewer product-model.ts.\n\nScenario: a change with plannedRelease \"@n-dx/core@0.8.0\", while 0.10.2 has shipped. The selector orders it as 0.8.0, but stale-release-plan reads it as non-semver and never flags it. rex validate, rex health and MCP health all stay silent about a stale plan the selector treats as old.\n\nReachable: plannedRelease is free text, set by `rex add`/edit_item or by hand. This repo's release stamp writes plain versions, so it does not happen here today. The cost is drift: the next change to release parsing has to land in two places.\n\nOptions:\n(a) Move one comparator into schema/ (v2-rules or a new schema/release.ts), and have change-selection import it (core → schema is the allowed direction). Small. The risk is changing selection order for non-semver names, so pin that with a test first. Recommended.\n(b) Keep both, and add a shared table-driven test that runs both on the same inputs. Cheaper, but it keeps the duplication."
acceptanceCriteria:
  - "rex has a single release comparator, used by both change selection and the stale-release-plan rule"
  - "An open change with plannedRelease \"pkg@0.8.0\" is reported by stale-release-plan when 0.10.0 has shipped, with a test"
  - "Change-selection ordering tests still pass unchanged"
touches:
  - "ab9eeda9-2419-4ef0-bff4-4c20251758aa"
fix: true
priority: "low"
discoveredFrom: {"item":"9156347e-7193-4d2e-9108-635e9e3705ad","run":"4613b163-3ea2-4ee1-b7bb-e61f1ec0552e"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
source: "ndx-adversarial-review"
---
