---
id: "c3303c54-9650-4875-8353-d3d7d6875bbc"
level: "task"
title: "Declare the level-of-effort fields and reserve effort in the v2 schema"
status: "completed"
priority: "high"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "761ab00d-e31b-4e8a-9c86-a4bde4584471"
source: "roadmap"
startedAt: "2026-10-07T16:03:26.242Z"
completedAt: "2026-10-07T16:07:58.847Z"
endedAt: "2026-10-07T16:07:58.847Z"
resolutionType: "code-change"
resolutionDetail: "v2 change and task intent declare loeRationale (string) and loeConfidence (low|medium|high) beside loe, and reserve effort with no shape. The intent/state table comment lists the new fields."
acceptanceCriteria:
  - "loeRationale (string) and loeConfidence (low | medium | high) are declared on task and change intent"
  - "effort is reserved with no shape, listed beside hypotheses and links in the schema's reserved fields"
  - "The intent/state table comment in the v2 schema module lists the new fields"
description: "Since #526 the analyze and smart-add paths keep all three level-of-effort fields on every accepted item: loe (a number, engineer-weeks), loeRationale (string) and loeConfidence (low | medium | high). v2 declares loe only, on task and change intent. Declare loeRationale and loeConfidence beside it.\n\nReserve effort with no shape, the way hypotheses and links are reserved. The task-prep recommender (phases R1 to R4) plans an effort object { tier, loe, confidence, reasons, source, at } written by the recommender, the creator or the user; reserving the name now lets it arrive in a 1.x minor instead of as an undeclared passthrough key.\n\nConverting legacy string loe values (xs, s, m, l, xl) is the migration's job; see the data-fixes task under Generate the migration plan."
lastModified: "2026-10-07T16:07:59.491Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
