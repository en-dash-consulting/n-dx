---
id: "59749a83-8ba2-4737-9f91-c1a1f2f0248f"
type: "change"
title: "Fix structural in sourcevision-view-layer (2 findings)"
slug: "fix-structural-in-sourcevision-view"
intent: "- Cohesion 0.33 and coupling 0.67 qualify this as a dual-fragility zone requiring active governance; additions should require justification and two-consumer verification.\n- The zone's 3 files span two distinct concerns (view entrypoint barrel and threshold constants); splitting them would raise cohesion and reduce coupling to the viewer hub."
priority: "high"
source: "sourcevision"
---
