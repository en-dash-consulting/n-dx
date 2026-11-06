---
id: "42330c3f-dd30-445f-9021-f1cbec6c749e"
type: "change"
title: "Where it goes keeps the previous target's criteria edits until a new target's criteria are read"
slug: "where-it-goes-keeps-the-previous"
intent: "Found by ndx-adversarial-review of fe39744e. Pre-existing, so it is out of scope for that change. Verdict: out-of-scope, severity low.\n\nScenario: in \"Where it goes\" (packages/web/src/viewer/components/prd-tree/change-placement.ts, the seed effect in PlaceForm, around `readCriteria(chosen.target)`), choose Amends on target A and add or replace a criterion. Then choose a target B that has no `criteria` on its row, such as a search pick or an off-shortlist block from placement mode's map. The seed effect leaves `drafts` holding A's edits until `readCriteria(B)` resolves. During that window:\n- The compact layout's Place sends A's criteria delta as an amendment on B.\n- In the wide layout, the stale body is dry-run and pending-counted. Place enables only if that stale check returns ok before the read lands, which is a narrow window.\n\nAn `add` of A's criterion onto B succeeds, so the result is a wrong amendment recorded on B.\n\nReachability: the compact detail panel or placement mode → search pick or map block off the shortlist → press Place before the capability read returns.\n\nFix options:\n1. Recommended: clear `drafts` synchronously when the target changes (`setDrafts([])` before the async read), and treat the criteria as loading (Place disabled) until the seed lands. Cheap, and adds one test.\n2. Key the drafts by target and ignore drafts whose target differs from `chosen`. More state."
acceptanceCriteria:
  - "Choosing a target whose criteria must be read clears the previous target's criteria edits before the read resolves"
  - "Place stays disabled until the new target's criteria are read, and a test that holds the capability read open proves Place never sends the previous target's criteria delta"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "low"
discoveredFrom: {"item":"fe39744e-059c-46ec-ad96-a04ce74cd1e4","run":"10c7a962-d9f1-4cc6-93a8-617743b5a4b8"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
