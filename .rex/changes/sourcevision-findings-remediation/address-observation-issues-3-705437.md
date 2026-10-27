---
id: "7054370f-4ddb-45ab-85ab-dea1a6619a49"
type: "task"
title: "Address observation issues (3 findings)"
slug: "address-observation-issues-3-705437"
description: "- 1 circular dependency chain detected — see imports.json for details\n- Bidirectional coupling: \"web\" ↔ \"web-viewer\" (4+2 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects"
priority: "high"
source: "sourcevision"
---
