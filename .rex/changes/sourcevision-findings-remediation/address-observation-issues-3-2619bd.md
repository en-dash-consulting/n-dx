---
id: "2619bd1f-1c65-4a1f-af96-16a84294e3b6"
type: "task"
title: "Address observation issues (3 findings)"
slug: "address-observation-issues-3-2619bd"
description: "- 5 circular dependency chains detected — see imports.json for details\n- The message zone's low cohesion (0.45) combined with being the most-imported zone in the web layer suggests it has grown into a catch-all communication module; splitting it into typed message definitions and transport utilities would improve cohesion and make the import graph more precise.\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n\n---\n\nFixes for cross-level matching bugs in smart-add duplicate merge logic."
priority: "high"
source: "sourcevision"
---
