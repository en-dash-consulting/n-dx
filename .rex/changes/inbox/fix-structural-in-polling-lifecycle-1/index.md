---
id: "3dd2ccf4-9126-4b7a-a7f3-976f297488ab"
type: "change"
title: "Fix structural in polling-lifecycle (1 finding)"
slug: "fix-structural-in-polling-lifecycle-1"
intent: "- Duplicate use-polling-suspension.ts exists in both hooks/ and polling/ directories; one is likely a forwarding re-export creating an invisible seam that can drift out of sync."
priority: "high"
source: "sourcevision"
---
