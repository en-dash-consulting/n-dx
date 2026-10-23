---
id: "40e86ebd-e7be-4c1c-a9bb-4345275afb6a"
type: "change"
title: "Fix structural in viewer-polling-engine (1 finding)"
slug: "fix-structural-in-viewer-polling"
intent: "- Cohesion (0.4) and coupling (0.6) are both at warning thresholds; the three-file split across state, restart, and suspension suggests the zone may be at a natural boundary — add a barrel index.ts to make the public API explicit before adding more files."
priority: "high"
source: "sourcevision"
---
