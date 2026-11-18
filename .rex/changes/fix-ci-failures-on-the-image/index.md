---
id: "3bdfc1be-1390-4109-97dc-491665d29d97"
type: "change"
title: "Fix CI failures on the image attachments PR (#1085)"
slug: "fix-ci-failures-on-the-image"
summary: "PR #1085 adds gateway exports and a rex module that imports the v2 reader, but three test allowlists and one test file were not updated, so Tests fail on every OS."
intent: "CI on feat/prd-add-image-attachments fails in root, rex and web suites. Two failures are stale import/export allowlists for the new attachment surface; one is a preact act() leak in the new smart-add-input test."
acceptanceCriteria:
  - "Tests (root, rex, web) pass for the branch"
touches:
  - "3181cbc2-b8b7-45cf-98cc-abccadfe7352"
priority: "high"
source: "ndx-capture"
---
