---
id: "fb2f50df-9b43-48bc-8bcd-f6b985ecac23"
type: "task"
title: "Address observation issues (4 findings)"
slug: "address-observation-issues-4-findings"
description: "- Bidirectional coupling: \"web\" ↔ \"web-viewer\" (10+7 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.71) — 3 imports target \"web-viewer\"\n- Low cohesion (0.29) — files are loosely related, consider splitting this zone"
priority: "high"
source: "sourcevision"
---
