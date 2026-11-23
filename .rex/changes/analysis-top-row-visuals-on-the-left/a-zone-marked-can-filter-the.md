---
id: "c53e9ee4-77fe-4d8c-be9c-82c3873c33b8"
type: "task"
title: "A zone marked ! can filter the recommended fixes to nothing"
slug: "a-zone-marked-can-filter-the"
summary: "On early analysis passes, clicking some zones marked with '!' empties the list of fixes, because nothing in the list concerns them yet. This only makes a zone clickable when it has fixes to show."
description: "Verdict: should-fix (severity low-medium), from the adversarial review of feat/analysis-two-tile-top-row.\n\nzoneIssues (action-items.ts:330) puts '!' on every zone zoneNeedsAttention flags, whether or not any item touches it; the filter matches on item.zones. With the real zones.json at pass 1 ('Pass 1 of 4'), problems, suggestions and architecture findings are gated, so 5 of 10 '!' zones (.claude, rex-core, root, scripts, web) match 0 fixes: hover dims the whole list, pressing shows 'No recommended fix concerns X', the tooltip reads '0 recommended fixes concern X'. At full pass all 28 match.\n\nEvidence: packages/web/src/viewer/views/summary-panel.ts:63-80.\n\nFix (recommended, trivial): render the zone filter button only when it matches at least one fix; otherwise keep the plain '!'."
acceptanceCriteria:
  - "A '!' zone that matches no recommended fix is shown without a filter control"
  - "A '!' zone that matches at least one fix keeps its filter control"
  - "A test covers a zone with zero matching fixes"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
