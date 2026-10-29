---
id: "5eeaba10-0b5f-4d80-b786-e687846b5627"
type: "task"
title: "A sidecar redirect to the bare mount with a query or fragment is double-prefixed"
slug: "a-sidecar-redirect-to-the-bare-mount"
description: "Verdict: should-fix (trivial). packages/web/src/hub/proxy.ts:402 treats a Location as already under the mount only when it equals the prefix or starts with prefix + '/'; /x/recon?tab=2 and /x/recon#a become /x/recon/x/recon?tab=2. Fix: also accept prefix followed by ? or #."
acceptanceCriteria:
  - "Location /x/<name>?q and /x/<name>#f from a sidecar are forwarded unchanged, covered by a test"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
