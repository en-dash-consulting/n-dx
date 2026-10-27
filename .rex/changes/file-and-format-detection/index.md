---
id: "fe3eb56e-a017-4e19-980d-d3590b632824"
type: "change"
title: "File and Format Detection"
slug: "file-and-format-detection"
intent: "Improve file handling and format detection capabilities\n\n---\n\nThe detectDeadExports() function in callgraph-findings.ts only checks the call graph for usage. Exports consumed via dynamic imports (await import()) or used only through import edges (not direct calls) are incorrectly flagged as dead. This produces false positives for CLI command registrations (cmdConfig) and validators used through import chains."
acceptanceCriteria:
  - "cmdConfig in hench/cli/commands/config.ts is not flagged as unused"
  - "Validators in web/schema/validate.ts are not flagged as unused"
  - "Components in health-gauge.ts and logos.ts are not flagged as unused"
  - "No regression in detecting genuinely dead exports"
touches:
  - "3bf3754c-c0d0-4fb7-9cbd-5ebbddb85d51"
source: "llm"
---
