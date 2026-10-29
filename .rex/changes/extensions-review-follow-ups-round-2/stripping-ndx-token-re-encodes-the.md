---
id: "02f9888b-e27d-4a1e-adce-779eab7467a9"
type: "task"
title: "Stripping ndx_token re-encodes the sidecar's other query values and corrupts invalid UTF-8"
slug: "stripping-ndx-token-re-encodes-the"
description: "Verdict: should-fix. packages/web/src/hub/proxy.ts:194-201 round-trips the query through URLSearchParams: ?a=%20b&c&ndx_token=T becomes ?a=+b&c=, path=/a/b~c becomes %2Fa%2Fb%7Ec, and cb=%E9 becomes %EF%BF%BD (data loss). Fix: split the raw query on & and drop only segments whose decoded key is ndx_token, leaving the rest byte for byte (also for splitTokenQuery)."
acceptanceCriteria:
  - "Every query segment other than ndx_token reaches the sidecar byte for byte, covered by a test including %E9, a bare key and a ~"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
