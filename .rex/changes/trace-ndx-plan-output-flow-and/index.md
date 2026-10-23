---
id: "b3bdcdb5-1bed-46be-8190-56b022fa5787"
type: "change"
title: "Trace ndx plan output flow and identify the silent gap after 'Done.'"
slug: "trace-ndx-plan-output-flow-and"
intent: "Instrument the ndx plan execution path — from the LLM response completion signal through proposal parsing, merging, and final output — to identify exactly where output is suppressed. Determine whether the gap is in sourcevision analyze post-processing, rex analyze proposal building, or the orchestration layer between the two spawned commands."
acceptanceCriteria:
  - "A written or code-comment trace identifies each stage between 'Done.' output and the next user-visible line"
  - "The stage(s) responsible for the silent gap are named and their duration is measurable"
  - "Any buffered-but-not-flushed stdout paths are documented"
touches:
  - "fea07c28-af09-4696-9999-18eb37be4fc6"
priority: "high"
tags:
  - "cli"
  - "ndx-plan"
  - "dx"
source: "smart-add"
---
