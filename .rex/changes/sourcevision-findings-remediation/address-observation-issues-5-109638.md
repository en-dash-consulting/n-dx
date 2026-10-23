---
id: "109638b1-0eda-425d-a785-f2b87ecf6904"
type: "task"
title: "Address observation issues (5 findings)"
slug: "address-observation-issues-5-109638"
description: "- Bidirectional coupling: \"hench-agent-2\" ↔ \"web-dashboard\" (4+3 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 24 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.67) — 4 imports target \"web-dashboard\"\n- Low cohesion (0.33) — files are loosely related, consider splitting this zone\n- 11 entry points — wide API surface, consider consolidating exports"
priority: "high"
source: "sourcevision"
---
