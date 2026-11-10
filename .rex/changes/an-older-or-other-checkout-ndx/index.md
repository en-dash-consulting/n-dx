---
id: "bc7135ac-2396-44c3-af2c-24e966629d85"
type: "change"
title: "An older or other-checkout ndx replaces a newer n-dx hub, downgrading it or ping-ponging every project server"
slug: "an-older-or-other-checkout-ndx"
intent: "Adversarial review of capture/no-manual-restart (d59c6096c..3e16fdf2f). Verdict: must-fix. hubBuildMismatch (packages/core/web.js ~1330) compares version and sourceHash with !==, and ensureHub replaces on any mismatch. Trigger: a hub started by 'npx -y @n-dx/core@latest start' (0.10.3, the documented fallback) is replaced by a global 0.10.2 'ndx start' (downgrade); two source-linked checkouts (e.g. the main n-dx checkout and endash-test-repos/n-dx) alternate replacing each other, restarting every registered project server (25 on the operator's machine) each time. No test covers a hub newer than the CLI (tests/unit/web-stale-server.test.js). Fix (recommended): replace only when the hub is older (semver of its @n-dx/web < this ndx's) or reports no build identity; on equal version with a different sourceHash, replace only when the hub was started from this same checkout (have /api/hub/health report its package root); otherwise leave it and print a one-line note with no instruction. Alternative: newest build time wins — simpler but lets a stale-but-rebuilt checkout win."
acceptanceCriteria:
  - "ndx start never replaces a hub whose @n-dx/web version is newer than its own"
  - "With equal versions and different source hashes, ndx start replaces the hub only when that hub was started from this same checkout"
  - "A hub left running because it is newer or from another checkout produces a one-line note and no restart instruction"
  - "Unit and e2e tests cover hub-newer-than-CLI and two-checkout cases"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
discoveredFrom: {"item":"8c5a1439-ad72-437a-a53f-42b4adc01221"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
