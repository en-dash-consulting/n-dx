---
id: "cdd974c5-8086-4b71-bc67-405aa5937c94"
level: "task"
title: "Give the title-only slug rule a disambiguator for legitimately same-titled siblings"
status: "completed"
priority: "medium"
startedAt: "2026-09-02T12:34:33.247Z"
completedAt: "2026-09-02T12:35:27.749Z"
endedAt: "2026-09-02T12:35:27.749Z"
acceptanceCriteria: []
description: "Consolidating title-only slug collisions removed 35 real duplicates (25 root epic shells + 10 depth-2/3 container shells). The remaining 26 groups / 78 items are NOT duplicates: they share an auto-generated title template from sourcevision finding-driven task creation while holding distinct content. Examples: 'Fix move-file in web-viewer (1 finding)' x4 each target a different file (use-polling.ts, external.ts, status-filter.ts, progressive-loader.ts); 'Address pattern issues (1 findings)' x6 are six unrelated architectural findings. This blocks the parent feature as specified. Dropping the id suffix cannot represent 78 legitimately same-titled siblings, so the slug rule needs one of: (a) keep a short disambiguator only where a sibling collision exists, (b) generate distinct titles at finding-task creation time so the collision never forms, or (c) accept a positional suffix for collided siblings. Option (b) also fixes the underlying defect -- the titles are non-descriptive. Decide this before 'Replace the id-qualified slug with a title-only slug'."
lastModified: "2026-09-02T12:35:27.755Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
