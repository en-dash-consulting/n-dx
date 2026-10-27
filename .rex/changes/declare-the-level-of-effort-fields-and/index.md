---
id: "c3303c54-9650-4875-8353-d3d7d6875bbc"
type: "change"
title: "Declare the level-of-effort fields and reserve effort in the v2 schema"
slug: "declare-the-level-of-effort-fields-and"
intent: "Since #526 the analyze and smart-add paths keep all three level-of-effort fields on every accepted item: loe (a number, engineer-weeks), loeRationale (string) and loeConfidence (low | medium | high). v2 declares loe only, on task and change intent. Declare loeRationale and loeConfidence beside it.\n\nReserve effort with no shape, the way hypotheses and links are reserved. The task-prep recommender (phases R1 to R4) plans an effort object { tier, loe, confidence, reasons, source, at } written by the recommender, the creator or the user; reserving the name now lets it arrive in a 1.x minor instead of as an undeclared passthrough key.\n\nConverting legacy string loe values (xs, s, m, l, xl) is the migration's job; see the data-fixes task under Generate the migration plan."
acceptanceCriteria:
  - "loeRationale (string) and loeConfidence (low | medium | high) are declared on task and change intent"
  - "effort is reserved with no shape, listed beside hypotheses and links in the schema's reserved fields"
  - "The intent/state table comment in the v2 schema module lists the new fields"
touches:
  - "8b38b308-be40-4cb1-9f92-ee0233f0b8ac"
priority: "high"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
blockedBy:
  - "761ab00d-e31b-4e8a-9c86-a4bde4584471"
---
