---
id: "50a1ca05-8be6-45ed-8b62-33a076dcd4fe"
type: "task"
title: "Changes view sorts v-prefixed release labels as text, so v0.9.0 heads above v0.10.0"
slug: "changes-view-sorts-v-prefixed-release"
description: "Verdict: should-fix (adversarial review of f367bfaa, run 28be15c0). Scenario: a project whose changes carry plannedRelease \"v0.10.0\" and \"v0.9.0\". `VERSION` in packages/web/src/viewer/views/product-model.ts (compareReleases) accepts only digit-led labels, so both fall to localeCompare; reversed for newest-first, \"v0.9.0\" renders above \"v0.10.0\" (and v1.0.0-rc.1 above v1.0.0). The task promised newest release first by semver. Reachable on the Changes view of any v2 project that tags releases with a leading v (common git-tag style); this repo's labels are bare, so it does not show here. Options: (a) accept an optional leading v/V in VERSION and ignore it when comparing (one regex change plus a test; recommended); (b) leave as-is and document bare semver as the expected plannedRelease form (no code, but the view stays wrong for v-style projects). Risk of (a): a codename starting with v followed by digits is read as a version, which is the intended reading."
acceptanceCriteria:
  - "groupChangesByRelease orders [\"v0.9.0\", \"v0.10.0\", \"v1.0.0\"] as v1.0.0, v0.10.0, v0.9.0 (unit test in changes-view.test.ts)"
  - "A v-prefixed prerelease sorts below its release: v1.0.0 above v1.0.0-rc.1 (unit test)"
  - "Bare and v-prefixed labels of the same version compare equal in precedence (\"1.0.0\" vs \"v1.0.0\") and both still render as their own headings"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "changes-view"
source: "ndx-adversarial-review"
---
