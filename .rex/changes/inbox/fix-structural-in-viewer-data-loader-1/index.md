---
id: "15fc8ef8-ac04-4066-b712-9e189d803955"
type: "change"
title: "Fix structural in viewer-data-loader (1 finding)"
slug: "fix-structural-in-viewer-data-loader-1"
intent: "- Cohesion (0.4) and coupling (0.6) both sit at warning thresholds; the zone mixes a hook, a service, a utility, and a schema validator — consider whether schema-compat and validate belong in a dedicated schema sub-module to raise cohesion."
priority: "high"
source: "sourcevision"
---
