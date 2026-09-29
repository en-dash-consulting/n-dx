---
id: "7b49a455-bd2a-4e8e-a7cb-1a7a52283de3"
level: "task"
title: "Show where a long field changed in rex tree-diff's text output"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "prd-storage-additive"
source: "adversarial review of hench run ebcf67bf (task 8a850a37), 0.8.0 PR B2"
acceptanceCriteria:
  - "A changed field longer than the display width shows a window around the first differing character on both sides."
  - "Short fields render as today."
description: "Follow-up to 8a850a37. rex tree-diff's human-readable output truncates a changed field to the same leading characters on both sides, so a change in a long field (typically description) renders as two identical strings. The --json output is correct. The review suggested diff-aware windowing: find the first differing character and slice a window around it."
lastModified: "2026-09-29T03:54:24.334Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
