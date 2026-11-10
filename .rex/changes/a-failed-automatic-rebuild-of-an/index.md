---
id: "e076ee9a-d5b4-4dbb-963a-c6db1a03608d"
type: "change"
title: "A failed automatic rebuild of an existing but outdated dist/ makes ndx start fail for every project"
slug: "a-failed-automatic-rebuild-of-an"
intent: "Adversarial review of capture/no-manual-restart (d59c6096c..3e16fdf2f). Verdict: must-fix. packages/core/web.js ~2507-2512: ensureSourceBuild(webEntry, {checkLag:true}) failing returns 1; before this branch a lagging dist was a warning and ndx start went on. source-build.js ~307: a concurrent rebuild holding the lock also returns failure ('still rebuilding … nothing was run'). Trigger: a source-linked checkout with a type error in packages/web (mid-edit or a broken branch) → 'ndx start' in any project exits 1; two 'ndx start' at once → the second exits 1. Fix (recommended): when dist/ exists and only lags, a failed rebuild prints the build error as a warning and continues on the existing dist, and the build-mismatch hub replacement is skipped (a rebuild that failed cannot produce the build it would replace with); a missing dist still fails. A held rebuild lock is waited on (bounded) rather than failing."
acceptanceCriteria:
  - "A failed rebuild of a lagging-but-present dist warns with the build output and ndx start continues on the existing dist"
  - "After a failed rebuild, ndx start does not replace the hub for a build mismatch"
  - "A missing dist whose build fails still exits non-zero with the build output"
  - "A second ndx start waits for a rebuild in progress (bounded) instead of failing"
  - "Tests cover each case"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
discoveredFrom: {"item":"8c5a1439-ad72-437a-a53f-42b4adc01221"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
