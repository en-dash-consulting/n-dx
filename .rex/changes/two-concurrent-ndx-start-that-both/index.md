---
id: "a93bb3f9-c8bc-4dc0-8fb6-2b33a97d61b0"
type: "change"
title: "Two concurrent ndx start that both replace the hub: the second fails with 'did not release port'"
slug: "two-concurrent-ndx-start-that-both"
intent: "Adversarial review of capture/no-manual-restart (d59c6096c..3e16fdf2f). Verdict: should-fix (cheap). replaceOrDeferHub (packages/core/web.js): both commands identify the old hub; the first replaces it; the second's terminate is a no-op and waitForPortFree times out because the first's new hub now holds the port, so it throws after ~35s. Fix: when the port does not free, re-probe; if this user's current hub now holds it, join it instead of failing."
acceptanceCriteria:
  - "When another ndx start has already replaced the hub, a concurrent ndx start joins the new hub instead of failing"
  - "A test covers two concurrent replacements"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "low"
discoveredFrom: {"item":"8c5a1439-ad72-437a-a53f-42b4adc01221"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
