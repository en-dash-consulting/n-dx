---
id: "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
type: "capability"
title: "Product, Changes and capability views on fixtures"
slug: "product-changes-and-capability-views"
statement: "The web viewer provides a Product page, a Changes view and a capability page that render from v2 fixture data."
criteria: [{"id":"c1","text":"The Product page shall list areas and their capabilities, showing each capability's intent status and health."},{"id":"c2","text":"The Product page shall show open changes as overlays on the capabilities they affect."},{"id":"c3","text":"The Product page shall highlight capabilities that are revised or defective."},{"id":"c4","text":"The Changes view shall group changes by planned release and by stage."},{"id":"c5","text":"The capability page shall show the capability's statement, criteria, history and where it lives in code."},{"id":"c6","text":"When given a v2 fixture, the Product page, Changes view and capability page shall each render from that fixture's data."}]
requirements: [{"id":"2e233c46-e4fb-49d1-81e7-6e0fd58fc683:c4","title":"The Changes view shall group changes by planned release and by stage","description":"Linked to: packages/web/tests/unit/viewer/changes-view.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The Changes view shall group changes by planned release and by stage."]},{"id":"2e233c46-e4fb-49d1-81e7-6e0fd58fc683:c6","title":"When given a v2 fixture, the Product page, Changes view and capability page shall each render from that fixture's data","description":"Linked to: packages/web/tests/unit/viewer/changes-view.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When given a v2 fixture, the Product page, Changes view and capability page shall each render from that fixture's data."]}]
tags:
  - "product-map"
  - "pr-14"
  - "lane-web"
  - "web"
source: "roadmap"
priority: "medium"
---

Build the new views against v2 fixtures only, so the UI work can run in parallel with the store. No routes or wiring.

Roadmap PR 14 · wave 1 · lane web.
