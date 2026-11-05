---
id: "63203636-b90b-455d-9d06-f3c9272bddf5"
type: "task"
title: "A sign-in test claims to refuse another connection's state but never makes one"
slug: "a-sign-in-test-claims-to-refuse"
description: "Found by the adversarial review of task 56b4e856 (run 0aaacd55). In packages/web/tests/unit/server/connections/oauth-provider.test.ts, the test named \"refuses a wrong, reused, expired or other connection's state and stores nothing\" sets up a single `docs` connection, so it never passes connection A's state to finishSignIn for connection B. The guard (`flow.connection !== config.id` in ConnectionOAuth.finishSignIn, packages/web/src/server/connections/oauth-provider.ts) is correct by reading, but no test would catch its removal, and the test name says one does. It is reachable once C2's sign-in route passes the connection id from the redirect. Verdict: should-fix, low. The fix is cheap and safe: declare two OAuth connections against the fake server, start a sign-in on one, and finish it on the other. Alternative: drop \"or other connection's\" from the test name. Recommended: add the case."
acceptanceCriteria:
  - "A test starts a sign-in for connection A, calls finishSignIn for connection B with A's code and state, and expects ConnectionSignInError with nothing stored for B"
  - "That test fails when the flow.connection !== config.id check in ConnectionOAuth.finishSignIn is removed"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
