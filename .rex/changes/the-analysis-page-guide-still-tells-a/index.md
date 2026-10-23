---
id: "26f7e15e-8036-4e90-9d6b-9300a2692d65"
type: "change"
title: "The Analysis page guide still tells a v2 user to use Smart Add and accept generated proposals"
slug: "the-analysis-page-guide-still-tells-a"
intent: "Found by an adversarial review of fe4ea50b (v2 add panel renamed \"Add to Inbox\"). Severity low; verdict out-of-scope (pre-existing, packages/web/src/viewer/components/guide.ts:108-111 was not touched by that change).\n\nScenario: open the Plan/Analysis page on a v2 project and open its page guide. The `analysis` entry says \"Use Smart Add to draft items from a description. Run a project scan to generate proposals...\", but on v2 the panel is now \"Add to Inbox\" and makes one change with no LLM breakdown. The guide and the panel name the same control differently. Reachable from the dashboard guide on every v2 project.\n\nOptions: (a) make the guide entry layout-aware (the view already reads the layout from GET /api/rex/changes), with v2 text naming Add to Inbox and placement. This is cheap, and it is the recommended option. (b) Use neutral wording for both layouts, which loses v1 specificity."
acceptanceCriteria:
  - "On a v2 project the Analysis page guide names Add to Inbox and does not say Smart Add or generated proposals for adding from a description"
  - "On a v1 project the Analysis page guide keeps its Smart Add wording"
  - "A viewer test pins both guide texts"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "v2"
  - "dashboard"
  - "web"
source: "ndx-adversarial-review"
---
