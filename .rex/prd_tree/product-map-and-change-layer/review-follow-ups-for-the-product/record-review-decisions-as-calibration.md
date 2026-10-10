---
id: "f7af456c-cc9d-4464-ac95-cb04572405db"
level: "task"
title: "Record review decisions as calibration records on the run record"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "learning-evidence"
  - "rx8"
source: "overnight-side-session"
acceptanceCriteria:
  - "A reviewed decision is written to the run record with class, answer, confidence, acted and decidedBy (test)"
  - "A run with no review decisions writes an empty decisions list, and older run records without the field still read (test)"
description: "Turn review decisions into decisions[] records on the run record: the class, the answer, its confidence, whether it was acted on, and who decided, as jev-decision-points.md section 5 proposes, so calibration is computed by n-dx rather than read out of a UI. This changes the run-record format, not the PRD. It depends on the plan file storing those fields (RX5, PR 23). Background: workshop rex-improvements.md RX8; belongs to the learning-evidence lane."
lastModified: "2026-10-10T05:16:45.618Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
