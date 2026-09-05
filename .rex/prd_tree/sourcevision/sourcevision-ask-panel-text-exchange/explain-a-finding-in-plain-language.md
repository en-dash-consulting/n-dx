---
id: "a31d22af-f520-47c9-b29f-8174e75ef88e"
level: "task"
title: "Explain a finding in plain language from the Problems and Suggestions surfaces"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "sourcevision"
  - "findings"
  - "llm"
blockedBy:
  - "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
  - "74c3fee8-3281-4b30-8157-8794ea68aea5"
source: "ndx-capture"
acceptanceCriteria:
  - "Every finding row in the Problems and Suggestions views offers an Explain action"
  - "Explain navigates to the Ask panel with the finding pre-seeded as structured seed context (type, severity, zone, message, files), not as a pre-written prose prompt"
  - "The explanation names the actual zone and files from the finding rather than giving generic advice about the finding type"
  - "The explanation states what a fix would touch, so it is actionable rather than descriptive"
  - "The explained answer supports the same Copy and Capture-to-PRD actions as a free-form answer"
  - "Explain works for every finding type and severity present in the fixture data, including findings with no severity set"
  - "A unit test asserts the seed context reaches the endpoint with the finding's zone and files intact"
description: "Findings today are presented as classified rows (type, severity, zone, message) via FindingsList in the Problems and Suggestions views. A row tells the user that something is wrong but not what it means for this codebase or what fixing it involves.\n\nAdd an Explain action per finding that opens the Ask panel pre-seeded with that finding as structured seed context -- id, type, severity, zone, message, and the files involved -- and returns a plain-language explanation. The answer should cover what the finding means, why it matters in this specific repository (naming the zone and files, not generic advice), and what a fix would touch.\n\nThe explanation must be grounded in the finding and the analysis data. An explanation that could have been written without reading this repo is a failed explanation, and the acceptance criteria are written to make that testable."
lastModified: "2026-09-01T14:06:19.441Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
