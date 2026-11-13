---
id: "262e0cf4-eaa3-4d9e-b37c-98d5b1d3b473"
type: "change"
title: "cli-start-stale-hub flakes on Linux CI: two concurrent ndx start against an older hub"
slug: "cli-start-stale-hub-flakes-on-linux-ci"
summary: "One end-to-end test of starting the dashboard twice at once fails intermittently on Linux CI, turning unrelated pull requests red. It needs a fix so CI results can be trusted again."
intent: "tests/e2e/cli-start-stale-hub.test.js > \"two ndx start at once, both finding the older hub > both succeed: one replaces it, the other joins the new hub instead of failing on the port\" fails intermittently on the Linux root+llm-client CI job. On 2026-11-13 it failed on five branches out of the last 30 CI runs (feat/codex-sidecar-broker, feat/stack-review-followups, feat/v2-change-task-wording, feat/sidecar-authoring-cards, prd/feature-flag-cleanup), including a PRD-only branch (#1037) where it failed three attempts running, while the same commit plus code passed on the branches above it. It also failed once locally on Windows under a full root-suite run and passed alone.\n\nThe assertion varies between attempts, which points to a race rather than a deterministic break:\n- \"Registering with the n-dx hub failed (unreachable): expected 1 to be +0\" (one start exits 1)\n- \"Note: The n-dx hub on port <p> needs replacing: the running n-dx hub predates this ndx (it reports no build identity). It was left running because it could not be identified as this user's hub (the recorded hub (PID <n>) is not running).\"\n\nRelated recent fixes in packages/core/hub-replacement.js: 550067f85 (join the new hub when a concurrent ndx start replaced it first), b465814cc, 2bb9ccdd0 (do not defer on a hub that a concurrent ndx start is stopping).\n\nFind whether the race is in the product (two concurrent ndx start against an old hub can really fail) or in the test fixture, and fix the cause. Do not widen timeouts or retry the test to hide it."
acceptanceCriteria:
  - "The root cause is identified and named in the fix: product race or test-fixture race"
  - "Two concurrent ndx start against an older hub both succeed, one replacing the hub and the other joining the new one, across repeated runs (at least 30 consecutive passes of the test locally, including under parallel load)"
  - "No timeout is widened and no retry is added to make the test pass"
  - "A patch changeset names every affected scoped package when product code changes"
touches:
  - "08464700-9955-4338-87b6-afea0646a6f8"
priority: "high"
source: "ndx-capture"
---
