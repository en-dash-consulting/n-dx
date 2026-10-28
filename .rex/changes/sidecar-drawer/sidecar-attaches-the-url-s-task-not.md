---
id: "08d89ce7-c417-4ab9-84ae-7ac29f30270d"
type: "task"
title: "Sidecar attaches the URL's task, not the task picked in the Tasks tree"
slug: "sidecar-attaches-the-url-s-task-not"
description: "Verdict: should-fix (medium). Found by the adversarial review of story 09 (run 7448a0e6).\n\nScenario: open /prd (no sub-id), click a task in the tree. The detail panel shows it, but selection is local state (use-item-selection.ts) and never reaches the route. main.ts passes page.taskId (route only) to useSidecarShell, so pageItemFor(packages/web/src/viewer/hooks/use-sidecar-attachment.ts) returns null: no attachment chip, General lens, and an open session is not re-targeted. Only a deep link /prd/<id> attaches.\n\nReachable: Tasks page, the most common way to look at a task.\n\nOptions:\n1. (recommended) Report the selected PRD item from PRDView to main.ts, like ProductPage's onCapabilityChange, and fold it into the Sidecar page selection. Small; keeps routing untouched.\n2. Make tree selection update the route (/prd/<id>). Wider: changes history behaviour for every tree click."
acceptanceCriteria:
  - "Selecting a task in the Tasks tree with no task in the URL shows it on the Sidecar attachment chip and gives the Describe lens (tested)"
  - "With a Sidecar session open, selecting a different task in the tree PATCHes the session's target to that task (tested)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
