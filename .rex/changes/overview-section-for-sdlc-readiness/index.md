---
id: "f9cac7fd-8482-4bcb-b215-395cee472c47"
type: "change"
title: "Overview section for SDLC readiness and discovered infrastructure"
slug: "overview-section-for-sdlc-readiness"
intent: "Add a section to the dashboard Overview (packages/web/src/viewer/views/overview.ts) that renders readiness.json and infrastructure.json, served through the web server's existing sourcevision gateway."
acceptanceCriteria:
  - "The Overview shows the overall readiness score and each practice's score (tests, CI, CD, rollback, migrations, feature flags, quality gates, observability, agent safety) with the evidence behind each"
  - "The Overview lists infrastructure.json resources grouped by kind, each with the file that declares it"
  - "A missing readiness or infrastructure artifact, or one from an older analysis, shows an empty state pointing at ndx analyze rather than breaking or hiding silently"
  - "The section's copy states that readiness is heuristic: it detects whether a practice exists, not whether it is good"
  - "Viewer tests cover both the present and absent cases"
touches:
  - "26a42aed-6a93-471f-9ab4-259b97877d68"
priority: "high"
source: "ndx-capture"
---
