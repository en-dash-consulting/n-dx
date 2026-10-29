---
id: "10c03aa1-046b-4eb9-ad6d-f5d128e5aad5"
type: "task"
title: "An ndx_token query parameter is forwarded to sidecars on non-GET and WebSocket requests"
slug: "an-ndx-token-query-parameter-is"
description: "Verdict: should-fix (trivial; contradicts docs/extensions/hub-api.md 'a sidecar never sees the credential'). request-guard.ts:110-117 and proxy.ts:133,186-195 forward POST /x/foo/?ndx_token=T or ws://.../x/foo/?ndx_token=T with the token in the path. Low impact since sidecars get NDX_TOKEN_FILE anyway. Fix: strip ndx_token from the forwarded query on sidecar decisions."
acceptanceCriteria:
  - "No request forwarded to a sidecar carries ndx_token in its query, for HTTP of any method and for WebSocket upgrades"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
