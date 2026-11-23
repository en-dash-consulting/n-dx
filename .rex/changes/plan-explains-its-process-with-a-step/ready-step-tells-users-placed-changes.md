---
id: "58f54d52-91c0-4268-a2ea-0a345baa7204"
type: "task"
title: "Ready step tells users placed changes cannot run, and its advice never clears it"
slug: "ready-step-tells-users-placed-changes"
summary: "The planning guide tells people their planned changes can't run and to add a requirement, but those changes do run and following the advice changes nothing. This corrects the guidance so it matches what the tools actually do."
description: "Verdict: must-fix (severity high), from the adversarial review of feat/plan-process-visual (347880e).\n\nTrigger: v2 project, empty Inbox, nothing awaiting apply, stages.ready = 0, stages.proposed = N. The band marks Ready 'Do this next' with 'N changes placed but not runnable: add an automated requirement'. But ndx work runs Proposed changes (rex/src/core/change-selection.ts:33: 'ready is informational'; readyOnly only with --ready-only, which hench never passes). Only `rex ready` writes the ready flag (rex/src/core/ready.ts:18), so following the cue never clears it. The lifecycle strip below shows a non-null Next pick at the same time, contradicting it. On this repo ~1,513 changes and one ready: true, so the band points here almost permanently, even with work in progress, because Proposed outranks In progress.\n\nEvidence: packages/web/src/viewer/views/plan-process.ts:35 (step text), :69-70 (cue).\n\nFix (recommended a+b, local to processFocus, no server change): (a) reword so it does not claim the change cannot run, e.g. 'N placed changes not marked ready: add an automated requirement, then run rex ready', and rank Proposed below In progress and below a non-null summary.next; (b) use summary.requirements.uncovered to ask for a requirement only when changes lack one, else say 'run rex ready'. Optional (c): link Ready to the 'Specs to tighten' tile."
acceptanceCriteria:
  - "The Ready step's text and cue do not state that placed changes cannot run"
  - "When summary.next is non-null or work is in progress, the band does not highlight Ready ahead of Work"
  - "The cue asks for an automated requirement only when summary.requirements.uncovered is non-zero, and otherwise tells the user to run rex ready"
  - "Unit tests cover Proposed with and without uncovered requirements, Proposed alongside In progress, and Proposed alongside a Next pick"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
