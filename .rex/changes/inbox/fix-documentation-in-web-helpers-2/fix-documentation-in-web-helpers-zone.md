---
id: "d262a54e-0a71-4580-b100-9f7c7e265699"
type: "task"
title: "Fix documentation in web-helpers: Zone name 'web-helpers' is misleading for a single-component zone — it invites s (+1 more)"
slug: "fix-documentation-in-web-helpers-zone"
description: "- Zone name 'web-helpers' is misleading for a single-component zone — it invites scope creep by suggesting a general utility bucket rather than a bounded component zone, and may attract future additions that bypass the two-consumer rule check.\n- Add a 'confirmed zone-level cycles' section to CLAUDE.md's architectural governance table, separate from the metric-based dual-fragility table. The only true cycle in the monorepo is more dangerous than all metric-triggered zones yet is invisible to threshold-based governance because web-helpers has cohesion 1 and coupling 0."
priority: "high"
source: "sourcevision"
---
