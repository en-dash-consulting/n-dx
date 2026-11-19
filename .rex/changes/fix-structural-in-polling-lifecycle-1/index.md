---
id: "3dd2ccf4-9126-4b7a-a7f3-976f297488ab"
type: "change"
title: "Fix structural in polling-lifecycle (1 finding)"
slug: "fix-structural-in-polling-lifecycle-1"
intent: "- Duplicate use-polling-suspension.ts exists in both hooks/ and polling/ directories; one is likely a forwarding re-export creating an invisible seam that can drift out of sync."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "high"
source: "sourcevision"
---
