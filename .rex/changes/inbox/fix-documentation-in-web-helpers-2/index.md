---
id: "9df71711-8089-4ba1-8933-725aa23ccfdc"
type: "change"
title: "Fix documentation in web-helpers (2 findings)"
slug: "fix-documentation-in-web-helpers-2"
intent: "- Zone name 'web-helpers' is misleading for a single-component zone — it invites scope creep by suggesting a general utility bucket rather than a bounded component zone, and may attract future additions that bypass the two-consumer rule check.\n- Add a 'confirmed zone-level cycles' section to CLAUDE.md's architectural governance table, separate from the metric-based dual-fragility table. The only true cycle in the monorepo is more dangerous than all metric-triggered zones yet is invisible to threshold-based governance because web-helpers has cohesion 1 and coupling 0."
priority: "high"
source: "sourcevision"
---
