---
id: "c4b9b3f5-5b3a-43c0-938a-b5cd66810bb1"
level: "task"
title: "Update rex add and ndx add pipelines to use branch-scoped PRD file creation and targeting"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "cli"
  - "smart-add"
source: "smart-add"
startedAt: "2026-04-22T18:57:46.661Z"
completedAt: "2026-04-22T19:12:07.338Z"
resolutionType: "code-change"
resolutionDetail: "Wired branch resolution into resolveStore, cmdAdd, and acceptProposals; added target file display in approval flow; 9 new integration tests."
acceptanceCriteria:
  - "ndx add creates or appends to the current branch's prd_{branch}_{date}.json file"
  - "rex add --file import targets the current branch's PRD file for new items"
  - "The approval flow displays which PRD file proposals will be written to"
  - "Piped input and batch add operations respect branch-scoped file targeting"
  - "Existing smart-add tests pass with the new multi-file backend"
description: "Wire the branch resolution and file selection logic into the rex add and ndx add command paths so that new proposals are written to the current branch's PRD file. Ensure the LLM proposal generation, approval flow, file-based import, and piped input all respect the multi-file storage model without changing their user-facing behavior."
---
