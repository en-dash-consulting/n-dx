---
id: "db723980-e057-4436-b3a3-e459f2d99771"
level: "task"
title: "Web Product view still shows \"map node\" wording after decision N1"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "product-map"
  - "web"
  - "pr-21"
  - "lane-web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The Product view renders \"all product nodes\" (not \"all map nodes\") for a constraint that applies to all, and product-view.test.ts asserts it"
  - "No comment or string in packages/web/src/viewer/views/product.ts or product-model.ts refers to a map node or map layer"
description: "Out-of-scope finding from the adversarial review of task 761ab00d (rename map layer → product in rex schema v2). Verdict: out-of-scope, pre-existing.\n\nDecision N1 renames \"map\" to \"product layer\" everywhere. The rex v2 schema now follows it, but the web viewer still uses the old term:\n- packages/web/src/viewer/views/product.ts:161 renders the user-visible tag \"all map nodes\" (asserted at packages/web/tests/unit/viewer/product-view.test.ts:109).\n- packages/web/src/viewer/views/product-model.ts:31, 96 (\"Map layer\" section header), 141 and 172 still say \"map node\" in comments.\n\nTrigger: open the Product view on a constraint with appliesTo \"all\". The tag reads \"all map nodes\", while the schema, rule messages and docs now say \"product nodes\".\n\nReachability: the dashboard Product view.\n\nFix: rename the string and the comments, and update the test assertion. Cost: a few lines. Risk: none. This touches the web package, so it belongs in a web-lane PR, not the rex-store schema PR."
lastModified: "2026-10-07T21:53:28.156Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
