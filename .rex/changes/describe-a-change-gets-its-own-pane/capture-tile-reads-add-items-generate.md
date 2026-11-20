---
id: "6e49a8bc-2d2e-42a1-a670-d85a9893ec73"
type: "task"
title: "Capture tile reads Add Items / Generate until the PRD layout loads"
slug: "capture-tile-reads-add-items-generate"
summary: "While the Plan page is loading, the capture tile no longer flashes its old name and button before switching to Describe a change."
description: "Found on fix/plan-analyze-ui-polish (visible in plan-loading.png): `useStatusLayout` reports v1 until the status response arrives, so the capture tile first renders as \"Add Items\" with a \"Generate\" button, then switches to \"Describe a change\" / \"Preview\"."
acceptanceCriteria:
  - "Until the PRD layout is known, the capture tile shows a neutral loading state, not the v1 title or button"
  - "On a v2 project the first labels shown are 'Describe a change' and 'Preview'; on v1 the first are the v1 labels"
  - "A test covers the unknown-layout state"
priority: "low"
source: "ndx-capture"
---
