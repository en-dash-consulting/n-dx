---
id: "f223f7ef-a609-4707-88ea-53a7eda45ea6"
type: "change"
title: "Fix documentation in packages-web:unit-server (1 finding)"
slug: "fix-documentation-in-packages-web-unit"
intent: "- packages-web:unit-server meets the dual-fragility criteria (cohesion 0.45, coupling 0.55) but is excluded from CLAUDE.md's governance table by the 'production zones' qualifier. Either add an explicit exemption note for test zones with rationale, or add this zone to the table — the structural fragility that the governance rules address (wide blast radius from internal file moves) applies equally to test zones."
touches:
  - "31fa50b1-31fc-48f3-a311-341ddbd510de"
priority: "high"
source: "sourcevision"
---
