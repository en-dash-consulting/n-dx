---
id: "c4b9b3f5-5b3a-43c0-938a-b5cd66810bb1"
type: "change"
title: "Update rex add and ndx add pipelines to use branch-scoped PRD file creation and targeting"
slug: "update-rex-add-and-ndx-add-pipelines"
intent: "Wire the branch resolution and file selection logic into the rex add and ndx add command paths so that new proposals are written to the current branch's PRD file. Ensure the LLM proposal generation, approval flow, file-based import, and piped input all respect the multi-file storage model without changing their user-facing behavior."
acceptanceCriteria:
  - "ndx add creates or appends to the current branch's prd_{branch}_{date}.json file"
  - "rex add --file import targets the current branch's PRD file for new items"
  - "The approval flow displays which PRD file proposals will be written to"
  - "Piped input and batch add operations respect branch-scoped file targeting"
  - "Existing smart-add tests pass with the new multi-file backend"
touches:
  - "44c38797-0009-4f44-8adc-38b5bd5a830e"
priority: "high"
tags:
  - "rex"
  - "cli"
  - "smart-add"
source: "smart-add"
---
