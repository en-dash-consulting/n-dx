---
id: "e4387d5b-5cb9-49c8-906a-c78fb748a4e1"
type: "task"
title: "The graview-face sidecar cannot be served through the hub at /x/graview-face/"
slug: "the-graview-face-sidecar-cannot-be"
description: "Verdict: should-fix. packages/graview-face/bin/serve.js binds Vite to host 'localhost', which resolves to ::1 on Node 24 here, while the hub probes 127.0.0.1, so health never passes (20 s, 503, counted as a crash). Even on IPv4, index.html loads /src/main.tsx and /@vite/client and app.ts fetches /data/... from the root, ignoring X-Ndx-Base-Path. `ndx graview serve` (foreground) is unaffected. Fix options: (a) when PORT comes from the hub, bind 127.0.0.1 and set Vite base to /x/graview-face/ with ndx-door.ts dev middleware following (moderate); (b) declare the face not hub-mountable and give `ndx graview serve` another way to find the bin (touches the core contract). Recommend (a)."
acceptanceCriteria:
  - "With graview-face installed and enabled, GET /x/graview-face/ through the hub renders the face with all assets and data requests under the mount"
  - "ndx graview serve behaves as before, checked by the existing graview tests"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
