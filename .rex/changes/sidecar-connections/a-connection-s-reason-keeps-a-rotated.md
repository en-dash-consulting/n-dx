---
id: "0c8ed747-b17e-4887-93cd-fff683d332bb"
type: "task"
title: "A connection's reason keeps a rotated-out token, because the scrub re-reads the store instead of using the token that was sent"
slug: "a-connection-s-reason-keeps-a-rotated"
description: "Found by ndx-adversarial-review of task cd5defa2 (verdict should-fix, severity low).\n\nScenario: a live token connection was opened with token A (packages/web/src/server/connections/connection-service.ts, transportFor). The operator stores token B as connection:<id> while A's client is still live. A later call fails with a 500 whose body echoes `Authorization: Bearer A`. scrubReason calls withoutConnectionToken (connection-credentials.ts), which re-reads the store and replaces B, not A. Only redactSecrets is left to catch A, and it catches only secret-shaped values. Two more gaps: scrubReason skips the exact-token swap for auth \"oauth\" entirely, and an OAuth refresh rotates the token on every refresh, so once the OAuth task lands, rotation is routine.\n\nReachability: the Settings and OAuth tasks make token changes while a client is live a normal event. Today it needs a manual re-store mid-session.\n\nOptions: (a) recommended: keep the exact token the transport sent on the slot (or Live) and scrub with that value, for both token and oauth auth. This is cheap, keeps the value in memory only, and drops the extra store read on every failure. (b) scrub both the stored token and the one that was sent. More reads, no gain over (a)."
acceptanceCriteria:
  - "A test connects with token A, stores token B, makes a call fail with a body echoing A, and asserts the reason contains neither A nor B"
  - "An oauth connection's reason never contains the access token it sent (test once the OAuth client lands)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
