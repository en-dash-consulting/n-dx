---
id: "acebe9ce-090f-480e-a9fd-e578f2b34a2b"
level: "feature"
title: "Overview Next Steps panel: consistent formatting, copyable items, and capture-to-PRD action"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "Next Steps panel uses the same section styling as sibling Overview panels (headers, spacing, typography) in both light and dark themes"
  - "Each next-step item has a copy control that copies its title and description; a copy-all control copies the full list as markdown"
  - "A capture-to-PRD button at the bottom of the panel creates PRD items from the listed findings via the existing recommend/add path, with confirmation and success/error feedback"
  - "Captured items are placed under an appropriate parent and deduplicated against existing PRD items"
  - "Loading, empty, and error states are handled consistently with the rest of the Overview page"
description: "The Next Steps panel on the SourceVision Overview (NextStepsPanel in packages/web/src/viewer/views/overview.ts, backed by /api/sv/next-steps) is styled differently from the rest of the page. Restyle it to match the Overview's section conventions, make each recommendation copyable (per-item copy control plus copy-all as markdown), and add a button at the bottom of the panel that captures the listed findings into the rex PRD (ndx-capture-style, via the existing recommend/add path) so the findings become actionable work items."
---
