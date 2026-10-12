---
id: "d9c3f156-0101-4845-bfd5-630b7689f4b2"
level: "task"
title: "Derive area links and propose dependsOn from shared tests"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "v2"
  - "migration"
  - "rx18"
source: "overnight-side-session"
acceptanceCriteria:
  - "product-edges computes an area-to-area edge from capability coChanges and shared test files, with no stored schema field (test)"
  - "The migration plan proposes dependsOn between two capabilities that share a test file (test)"
  - "Capabilities that share nothing get no proposed dependsOn and no area edge (test)"
description: "v2 has no area-level edge and the migration proposes no dependsOn (0 of 309 capabilities in the 2026-10-09 run, while 67 test files are shared by capabilities in different areas). Roll capability coChanges and shared test files up to a computed area-level edge in packages/rex/src/core/product-edges.ts, and let the migration plan propose dependsOn where capabilities share tests or code. The roll-up is computed, so it adds no schema field; showing it in get_product would be an additive MCP change and needs a release-note entry under the soft freeze. Background: workshop rex-improvements.md RX18."
lastModified: "2026-10-10T05:16:45.030Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
