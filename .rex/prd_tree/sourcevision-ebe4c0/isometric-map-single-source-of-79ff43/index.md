---
id: "79ff43cf-43e9-4615-9227-31eb90b2d10f"
level: "feature"
title: "Isometric map: single source of truth, declared architecture, dashboard view"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "visualization"
  - "isometric"
  - "web"
  - "skill"
source: "ndx-capture: follow-up to gap assessment requested by user after the initial iso map shipped"
acceptanceCriteria: []
description: "Follow-up hardening of the isometric architecture map after the initial feature (see \"Optional 3D isometric architecture map generator\") shipped with known gaps.\n\nStructural: the portable `/iso-map` skill script was a hand-maintained second copy of the layout, routing and rendering logic and had already drifted from the package — the two disagreed on zone colours because one counted archetypes before mapping them to kinds and the other after. The skill is now a build artifact generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs`, with `tests/e2e/iso-skill-drift.test.js` failing on staleness and also executing the shipped bundle.\n\nData: the call graph is aggregated into per-edge runtime call counts with a Weight toggle; injection seams and runtime infrastructure — the two things no import graph can show — are read from `sourcevision.isoMap` in `.n-dx.json` and from Terraform, drawn in a distinct colour and labelled as declared rather than inferred.\n\nSurfaces: `ndx iso`, `sourcevision iso --source=scan`, `GET /api/iso-map`, and a dashboard view with generation controls.\n\nAlso: reproducible output (timestamps from the HEAD commit), source links from the git remote, obstacle-avoiding edge routing, tsconfig/workspace/go.mod import resolution in scan mode, and accessibility work (light theme, reduced motion, kind glyphs, skip link, one tab stop per zone).</description>\n<parameter name=\"acceptanceCriteria\">[\"The skill script is generated from the TypeScript sources, and a drift test fails when the committed bundle is stale or hand-edited\", \"The scanner, model, renderer and declared-architecture loader are covered by tests, and the generated bundle is executed by tests rather than only its sources\", \"Zone kind is resolved by one implementation shared between the package and the skill\", \"Call-graph data, where present, gives every connector a runtime call count with a UI toggle, and call-only edges are identified as injected seams\", \"Injection seams declared in .n-dx.json are drawn in the runtime control-flow direction and labelled as declared\", \"Runtime infrastructure is drawn from .n-dx.json declarations and from Terraform resource blocks, attributed to consuming zones\", \"A declaration that cannot be drawn is reported to the reader rather than silently dropped\", \"Regenerating the map from an unchanged checkout produces a byte-identical file\", \"The map is reachable and generatable from the web dashboard UI, not only the CLI\", \"The rendered page meets the project's accessibility bar: not colour-only, light and dark themes, reduced-motion, and a usable tab order\"]"
---

## Children

| Title | Status |
|-------|--------|
| [Extend iso map IaC discovery beyond Terraform](./extend-iso-map-iac-discovery-798897.md) | pending |
| [Verify declared injection seams against the code](./verify-declared-injection-seams-d9e4fb.md) | pending |
