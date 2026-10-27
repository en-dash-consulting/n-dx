---
id: "a7c0061e-eb80-473b-84b2-861194fbcc47"
type: "capability"
title: "Route the remaining .n-dx config readers through the resolver"
slug: "route-the-remaining-n-dx-config"
statement: "n-dx packages read project config, and the web server's pid, port and usage files, from the paths the layout resolver returns rather than from hard-coded .n-dx* paths, so config is honoured on both the .ndx/ and the legacy layouts."
criteria: [{"id":"c1","text":"When a project uses the .ndx/ layout, each package that reads project config shall honour values set in .ndx/config.json."},{"id":"c2","text":"When a project uses the legacy layout, each package that reads project config shall read it from .n-dx.json."},{"id":"c3","text":"Each package shall resolve the .n-dx.json, .n-dx.local.json, .n-dx-web.pid, .n-dx-web.port and .n-dx-web-usage.jsonl locations through the layout resolver, not through hard-coded literals."},{"id":"c4","text":"If a .n-dx* literal appears anywhere outside the policy's ALLOWED list, the layout-literal policy check shall fail and report that literal's file and line."}]
requirements: [{"id":"a7c0061e-eb80-473b-84b2-861194fbcc47:c1","title":"When a project uses the .ndx/ layout, each package that reads project config shall honour values set in .ndx/config.json","description":"Linked to: packages/sourcevision/tests/integration/project-config-layout.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a project uses the .ndx/ layout, each package that reads project config shall honour values set in .ndx/config.json."]},{"id":"a7c0061e-eb80-473b-84b2-861194fbcc47:c4","title":"If a .n-dx* literal appears anywhere outside the policy's ALLOWED list, the layout-literal policy check shall fail and report that literal's file and line","description":"Linked to: tests/e2e/layout-literal-policy.test.js","category":"technical","validationType":"automated","acceptanceCriteria":["If a .n-dx* literal appears anywhere outside the policy's ALLOWED list, the layout-literal policy check shall fail and report that literal's file and line."]}]
tags:
  - "product-map"
  - "pr-29"
  - "lane-models-analysis"
  - "sourcevision"
  - "core"
  - "web"
  - "hench"
source: "roadmap"
priority: "high"
---

After the layout-resolver sweep (#529), 29 hard-coded .n-dx* paths remain in 22 files (tests/layout-literal-inventory.md). On a project using the .ndx/ layout, config lives at .ndx/config.json, so these readers silently read nothing: sourcevision ignored risk justifications, zone types, language and inventory overrides, archetype overrides, workspace members and the iso-map architecture, and the analysis still succeeded. ndx init has created .ndx/ projects since 0.8.0, so this is live today, and 1.0.0 makes .ndx/ the only layout (decision A3a): every literal must be routed before the legacy refusal and this repository's migration. Mechanical; the inventory is the done-check. Run with --review.

Roadmap PR 29 · wave 1 · lane models-analysis.
