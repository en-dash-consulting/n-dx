---
id: "1650bac0-ba0f-4d7c-9e16-b4b11f866836"
type: "change"
title: "An area's open count and its filtered Open changes list agree on shipped changes"
slug: "an-area-s-open-count-and-its-filtered"
intent: "Follow-up to S9 (c21b26e5, applied), found by its browser check on 2026-11-06. On this repository the Hench block's badge, the area chip and the area view's Moving now all say 16, but /changes?area=hench lists 15. The missing change, 3b7c3a00 ('A git-tracked .n-dx.local.json widens hench's guard…'), has stage 'shipped' (done, not applied). AreaSection.openChangeIds (S3's server per-area rule in routes-rex/product.ts) counts it as open, while the Open changes list's Open filter leaves shipped changes out. S9's bc311c6d says the filtered count equals the badge's count. Use one definition of 'open' for both, preferably the one the Open filter and the lifecycle strip already use, so the badge, Moving now, the chip, the filtered list and the Product page total (4e3d99af) agree. Discovered from c21b26e5-e952-4ffa-bafb-d9090eec965a."
acceptanceCriteria:
  - "For every area, the badge count, Moving now's count, the area chip's count and the number of rows in /changes?area=<slug> are equal, including when an area has a shipped-but-unapplied change"
  - "A test with a shipped change on an area asserts the badge count equals the filtered list's length"
  - "The Product page total uses the same definition of open"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "high"
---
