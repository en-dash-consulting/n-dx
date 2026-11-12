---
id: "ae1508f4-7b22-41c3-8e70-cbd0ed1638b0"
type: "task"
title: "Make the safe-incremental guard unconditional and drop NDX_SV_SAFE_INCREMENTAL"
slug: "make-the-safe-incremental-guard"
description: "In analyzeImports, compute prevShapeOk from the shape check alone, delete the env read, and add a unit test that feeds a legacy-shaped previous imports.json."
acceptanceCriteria:
  - "The new unit test fails on main and passes with the change"
  - "The sourcevision test suite passes"
priority: "medium"
tags:
  - "feature-flags"
  - "sourcevision"
source: "ndx-capture"
---
