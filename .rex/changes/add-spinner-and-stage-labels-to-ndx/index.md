---
id: "8f3ffe22-c031-4b7a-97e4-c4895439d6ea"
type: "change"
title: "Add spinner and stage labels to ndx plan output between LLM response and proposal display"
slug: "add-spinner-and-stage-labels-to-ndx"
intent: "Insert a progress indicator (spinner or step label) immediately after the 'Done.' / 'Vendor: ...' lines so users know the process is still active. The indicator should cover at minimum the proposal-building and proposal-display phases. It must be suppressed in --quiet / JSON modes and must not interfere with the existing 'Done.' and 'Vendor: ...' output."
acceptanceCriteria:
  - "A spinner or step label appears immediately after 'Done.' / 'Vendor: ...' with no perceptible gap"
  - "The indicator is cleared and replaced by the next substantive output line when proposals are ready"
  - "Running ndx plan in a TTY shows the spinner; piped/non-TTY output omits it"
  - "ndx plan --accept produces identical behavior with indicator present before proposal acceptance"
  - "No duplicate or garbled output when the indicator and proposal output overlap"
amends: [{"target":"fea07c28-af09-4696-9999-18eb37be4fc6","delta":"modified","summary":"Add spinner and stage labels to ndx plan output between LLM response and proposal display","base":"d38edc3fb50c05fa4556f9016d90b7a811e3a410f8799269367ad05747e613ba"}]
priority: "high"
tags:
  - "cli"
  - "ndx-plan"
  - "dx"
  - "ux"
source: "smart-add"
---
