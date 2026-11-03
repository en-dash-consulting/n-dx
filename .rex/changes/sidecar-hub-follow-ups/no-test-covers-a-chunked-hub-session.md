---
id: "9f3e974d-5eea-43c4-8706-0c745d01fcb7"
type: "task"
title: "No test covers a chunked hub session body that outgrows the 1 MiB replay limit"
slug: "no-test-covers-a-chunked-hub-session"
description: "Verdict should-fix (medium, test quality), from the adversarial review of task 87b82506.\n\nproxyHubSession (packages/web/src/hub/proxy.ts) refuses an oversized body two ways: a Content-Length pre-check, and readBody(req, MAX_HUB_SESSION_BODY_BYTES, false) for a chunked body with no length. hub-session-proxy.test.ts sends its oversized body with fetch and a string body, which sets Content-Length, so only the pre-check runs. The chunked branch, and readBody's new destroyOnLimit=false mode (drain and drop the rest, keep the socket open for the 413), never run in a test. If someone reverted destroyOnLimit to destroying the socket, the client would get a reset instead of 413 and no test would fail.\n\nReachable from any client streaming a POST to /hub/session/… without Content-Length.\n\nFix: add one test that writes a chunked POST over a raw socket (Transfer-Encoding: chunked) larger than MAX_HUB_SESSION_BODY_BYTES, and asserts a 413 status line and no upstream request. Costs one test and carries no risk."
acceptanceCriteria:
  - "hub-session-proxy.test.ts sends a chunked (no Content-Length) hub session POST larger than MAX_HUB_SESSION_BODY_BYTES and receives a 413 status line, not a reset"
  - "The upstream project server records no request for that POST"
  - "The test fails if readBody is called with destroyOnLimit true for hub session requests"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
