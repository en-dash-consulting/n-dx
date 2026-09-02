---
id: "36121811-32bb-4800-b0d8-bd73cfbc4cf7"
level: "task"
title: "Make finding-derived task titles distinctive at generation time"
status: "completed"
priority: "low"
startedAt: "2026-09-02T13:05:53.194Z"
completedAt: "2026-09-02T13:09:23.794Z"
endedAt: "2026-09-02T13:09:23.794Z"
acceptanceCriteria: []
description: "Residue of choosing option (a) for the slug disambiguator: the collision-scoped -{id6} suffix makes 78 same-titled siblings addressable, but leaves the underlying defect that produced them. Finding-driven recommendation intake emits template titles that carry no information about the work: 'Address pattern issues (1 findings)' x6 are six unrelated architectural findings; 'Fix move-file in web-viewer (1 finding)' x4 each target a different file. The plural is not even agreed ('1 findings'), which is a cheap tell that no one reads these. These are not built from a format string anywhere in the repo -- grep finds only comments about the pattern -- so they arrive as data on the recommendation objects consumed by packages/rex/src/recommend/create-from-recommendations.ts, and the fix belongs where recommendations are produced (the sourcevision next-steps surface and the prompt behind it), not in the slug rule. Note packages/rex/src/recommend/conflict-detection.ts already accommodates the pattern rather than preventing it: lines 139 and 214-215 deliberately treat 'Address observation issues (4 findings)' as genuinely new work even when '(1 findings)' is already complete, precisely because the titles cannot be compared meaningfully. Fixing this would let a later slug rule drop the suffix entirely, and would make ndx status readable without opening each item. Suggested shape: have the generator name the subject (zone, file, or finding id) in the title, and add an intake guard that rejects or renames a proposed title that is not unique among its siblings."
lastModified: "2026-09-02T13:09:23.799Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
