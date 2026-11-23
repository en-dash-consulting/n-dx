---
id: "3007df6a-0c26-44c6-bb84-c2fe748c822a"
type: "change"
title: "Fix structural in viewer-data-hooks (1 finding)"
slug: "fix-structural-in-viewer-data-hooks-1"
intent: "- Bidirectional imports between this hook zone and the web platform zone (3 edges each direction) suggest the hooks may be reaching back into platform code rather than receiving dependencies via props or context."
touches:
  - "4cd7c27a-13d3-4fd3-85b4-9f309a4237fd"
priority: "high"
source: "sourcevision"
---
