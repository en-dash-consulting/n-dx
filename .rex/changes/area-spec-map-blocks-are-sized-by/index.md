---
id: "3b1e3393-3a36-413d-bf88-31d64e415e5a"
type: "change"
title: "Area spec map blocks are sized by their criteria count"
slug: "area-spec-map-blocks-are-sized-by"
intent: "Follow-up to 18fc7905 (change 9b5e6519, applied), found by the S6 browser check on 2026-11-05. Each .pam-block gets flex-grow equal to its criteria count over flex-basis 8rem (packages/web/src/viewer/styles/product.css, about line 724). With 28 blocks wrapping, each row has almost no free space, so every block renders about 128 px wide: at 1440 px on this repository's 'Product map and change layer' area (28 capabilities) a 4-criterion block drew 18,008 px2 and a 47-criterion block 15,935 px2 (0.88x). Size each block from its criteria count directly (for example a flex-basis or grid span proportional to criteria, with a readable floor, or a squarified layout), keep the order (changing and defective first, then by size), and keep blocks keyboard reachable with their accessible names. The Plan product area map (S3) shares .pam-block and scales only weakly (46 vs 14 capabilities drew 1.58x); fix it in the same change only if that does not regress it. Discovered from 18fc7905-b4e4-4e8a-8dbe-b541ea9a671f."
acceptanceCriteria:
  - "On a 28-capability area at 1440 px, a block with about 10x the criteria of another draws at least 3x its area, and the smallest blocks keep a readable floor"
  - "A unit test pins that each block's sizing style is derived from its criteria count, not only flex-grow over a fixed basis"
  - "Blocks keep their order, accessible names and keyboard reach; the Plan area map does not regress"
touches:
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
priority: "high"
---
