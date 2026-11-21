---
id: "7f60d52d-1ea1-45c9-ab7d-000ae52e708c"
type: "task"
title: "Count fallback source with the skip set of the Terraform-alone result"
slug: "count-fallback-source-with-the-skip"
description: "**should-fix.** Review: https://github.com/en-dash-consulting/n-dx/pull/822#discussion_r4303692910\n\nAt the #825 head, `packages/sourcevision/src/language/detect.ts:50` (`searchProjectFiles`) builds its skip set as `projectSkip(mergeLanguageConfigsWith([...otherConfigs, terraformConfig]), extraSkipDirs)`. For a markerless repository `otherConfigs` is the TypeScript fallback, so the search skips TS's directories (`dist`, `build`, `coverage`, …) while counting fallback source. A file found only there is not counted, so `{main.tf, dist/handler.js}` gives `fallbackSource === 0` → `isTerraformOnly` → `[terraform]`. The analyze-phase inventory then runs with Terraform's skip set alone, which does not skip `dist/`, and walks `dist/handler.js` as source. Detection and inventory disagree; the function's own doc comment (lines 35–42) records the gap. `packages/lang-kit/src/detect.ts:404-418` has the same shape (`searchProjectFiles([base], …)` then `return [terraformConfig]`).\n\nFix, either:\n- (a) count fallback source with the skip set of the Terraform-alone result (`projectSkip(terraformConfig)` plus `extraSkipDirs`), so `dist/handler.js` counts and the result is `[typescript, terraform]`, whose inventory skips `dist/`; or\n- (b) keep `[terraform]` but give the Terraform-alone result TypeScript's skip directories, so its inventory skips `dist/` too.\n\nPick one, apply it in both detect.ts files, and update the doc comment. Option (a) changes the expectation at `packages/sourcevision/tests/unit/language/terraform-config.test.ts:121` (\"does not count source the inventory ignores\", which today expects `[terraformConfig]` with `dist/bundle.js` present); keep the gitignored `generated-site/` half of that case as is (still not counted). Extend that test to run `analyzeInventory` with the detected configs and assert no `dist/` file is in the inventory. Update the matching changeset text if the rule changes (see the release-notes task in this feature)."
acceptanceCriteria:
  - "For a markerless repository holding only main.tf and dist/handler.js, detection and the analyze-phase inventory agree: dist/handler.js is never inventoried as source"
  - "terraform-config.test.ts's \"does not count source the inventory ignores\" case (line 121) also asserts the inventory, not only detectLanguage/detectLanguages"
  - "sourcevision's detect.ts and lang-kit's detect.ts apply the same rule, and both have a test for it"
  - "Analysis output for TypeScript, JavaScript, Go, Swift and Python repositories is unchanged"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "review-fixes"
  - "detection"
  - "inventory"
  - "terraform"
  - "sourcevision"
  - "lang-kit"
  - "pr-21"
source: "review"
---
