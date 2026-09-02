---
id: "e57210b1-621a-4e6d-bf8d-359ddf40d651"
level: "task"
title: "Evaluate whether the final cross-OS pipeline validation step earns its CI cost"
status: "pending"
priority: "high"
tags:
  - "ci"
  - "cross-os"
  - "pipeline"
  - "gauntlet"
source: "smart-add"
acceptanceCriteria:
  - "Pipeline stage definition is read and each assertion type is categorised (parity check, smoke test, structural, etc.)"
  - "At least one recent CI run history is reviewed to identify which assertions have actually caught regressions vs. always passed"
  - "Written recommendation is produced with a keep/tighten/narrow/remove verdict and supporting rationale"
  - "Recommendation addresses whether the macOS and Windows stages must both run on every PR or can be gated"
  - "Any proposed changes to the pipeline YAML are listed in the recommendation (not yet applied)"
description: "Review the final pipeline stage that validates CLI behaviour parity across Windows and macOS runners. Determine whether it catches real regressions that earlier stages miss, whether its current assertions are tight enough to be meaningful, and whether the cost (image build time, runner minutes, maintenance) is justified. Recommend: keep as-is, tighten assertions, narrow scope, or remove and absorb coverage into unit/integration layers."
lastModified: "2026-09-02T14:11:20.341Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
