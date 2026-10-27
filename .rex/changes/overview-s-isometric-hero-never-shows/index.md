---
id: "bdf96b3c-e37e-4d03-969c-a8585481876d"
type: "change"
title: "Overview's isometric hero never shows its Options button because the page does not pass onOpenOptions"
slug: "overview-s-isometric-hero-never-shows"
intent: "Severity: low. Verdict: out-of-scope (pre-existing), cheap to fix.\n\nIsoMapHero renders an \"Options\" button only when `onOpenOptions && !expanded` (views/iso-map.ts:497-502). views/overview.ts:460 mounts the hero without onOpenOptions, so the Overview hero offers Rebuild, New tab and Expand but no way to reach the map's source/node-count/externals form; the happy-click spec had to make that step conditional. Fix: pass `onOpenOptions: () => navigateTo(\"iso-map\")` from overview.ts (one line) and un-condition the spec step."
acceptanceCriteria:
  - "The Overview page's iso hero shows an Options button that navigates to /iso-map"
  - "packages/web/tests/e2e-ui/happy-click/sourcevision.spec.ts asserts the Options button unconditionally"
touches:
  - "79ff43cf-43e9-4615-9227-31eb90b2d10f"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "overview"
source: "ndx-adversarial-review"
---
