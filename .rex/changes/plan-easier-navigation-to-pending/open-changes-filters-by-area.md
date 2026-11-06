---
id: "bc311c6d-feb0-4707-824d-ab998cb6d6ff"
type: "task"
title: "Open changes filters by area"
slug: "open-changes-filters-by-area"
description: "Open changes takes an area filter: the address ?area=<slug>, a removable chip, reachable from the map badge and from the area view's Moving now card. It uses S3's per-area rule (openChangeIds), so the filtered list matches the badge. Use opus because the summary route or /api/rex/changes may gain the filter."
acceptanceCriteria:
  - "Open changes reads ?area=<slug> and lists only the changes in that area's openChangeIds"
  - "A removable chip names the area filter; removing it clears ?area= and shows every change"
  - "The map badge and the area view's Moving now card open Open changes with the area filter"
  - "The filtered count equals the badge's count for the same area, with a test"
---
