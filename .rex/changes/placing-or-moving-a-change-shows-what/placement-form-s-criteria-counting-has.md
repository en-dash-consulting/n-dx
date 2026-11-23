---
id: "fa89d951-0963-49b2-a09d-12e9b51a827c"
type: "task"
title: "Placement form's criteria counting has no test that would catch a regression"
slug: "placement-form-s-criteria-counting-has"
summary: "The placement form's count of added, reworded and removed requirements could break without any test noticing. This adds tests that would catch it."
description: "Verdict: should-fix (severity low, tests only), from the adversarial review of feat/placement-visuals.\n\nBreaking the added/replaced/removed filters or the 'criteria = drafts' originals' logic in previewOf (change-placement.ts:535-574) passes every test: the form test (change-placement.test.ts:305) asserts only the replacement statement text; the model tests feed counts directly. Wide mode, the applied and 'another' changes, and 'Picked by the model' in the form are also unasserted."
acceptanceCriteria:
  - "A form test adds, rewords and removes a criterion and asserts the after line reads N criteria (+1 added, 1 reworded, −1 removed)"
  - "A test renders the preview in the wide placement-mode panel"
  - "A test covers the model-picked reason in the form"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
