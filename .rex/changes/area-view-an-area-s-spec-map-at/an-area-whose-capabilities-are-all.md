---
id: "dd36321e-8552-4124-9ad9-5c3a78c14bfb"
type: "task"
title: "An area whose capabilities are all retired says it has no capabilities while its header counts them"
slug: "an-area-whose-capabilities-are-all"
description: "Verdict: should-fix, low. Found by the adversarial review of 8d78fb27a (retired capabilities left off the spec map).\n\nWhere: packages/web/src/viewer/views/area-spec-map.ts SpecMap. The empty check runs on liveCapabilities(), so an area with only retired capabilities shows \"This area has no capabilities yet.\" The area header's counts come from the server (routes-rex/product.ts:687, `capabilities: caps.length`), which counts retired capabilities. The header reads \"2 capabilities\" over a map that says there are none, and \"yet\" suggests nothing was ever specified.\n\nReachable: /product/area/<slug> for any area whose capabilities have all been retired.\n\nOptions:\n- (Recommended) When every capability is retired, say so: \"All of this area's capabilities are retired.\" Cost: one branch and a test.\n- Exclude retired capabilities from the header's capability count (server). Larger, and it changes the count the Plan area map shows too."
acceptanceCriteria:
  - "SpecMap with only retired capabilities does not say \"This area has no capabilities yet.\""
  - "SpecMap with only retired capabilities names that they are retired"
  - "A test in area-spec-map.test.ts covers it"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
