---
id: "00d195c1-d984-4708-9cfb-37eee5475122"
type: "task"
title: "Address pattern issues (2 findings)"
slug: "address-pattern-issues-2-findings-00d195"
description: "- The entire codebase has coupling > 0 only in the web messaging stack (3 zones); all other zones are at coupling 0 — this concentration means the messaging layer is the single point of architectural debt and deserves priority refactoring attention before it accretes further consumers\n- The web layer exhibits a hub-and-spoke topology with web-viewer (329 files) as the hub: it imports from message, web-integration, and web-package-scaffolding while being imported by dom. All other zones are spokes or isolated. This concentration of import edges in one zone is a scaling risk — as web-viewer grows, its import surface grows proportionally with no natural decomposition boundary."
priority: "high"
source: "sourcevision"
---
