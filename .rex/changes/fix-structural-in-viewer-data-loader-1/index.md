---
id: "15fc8ef8-ac04-4066-b712-9e189d803955"
type: "change"
title: "Fix structural in viewer-data-loader (1 finding)"
slug: "fix-structural-in-viewer-data-loader-1"
intent: "- Cohesion (0.4) and coupling (0.6) both sit at warning thresholds; the zone mixes a hook, a service, a utility, and a schema validator — consider whether schema-compat and validate belong in a dedicated schema sub-module to raise cohesion."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "high"
source: "sourcevision"
---
