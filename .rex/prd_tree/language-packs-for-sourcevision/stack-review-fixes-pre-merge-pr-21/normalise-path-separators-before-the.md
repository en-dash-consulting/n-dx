---
id: "f5df4ad4-bac1-4f08-a984-c0f4e7bf477f"
level: "task"
title: "Normalise path separators before the Terraform model test filters caches"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "windows"
  - "ci"
  - "terraform"
  - "pr-21"
source: "review"
startedAt: "2026-10-17T17:53:40.819Z"
completedAt: "2026-10-17T17:55:30.454Z"
endedAt: "2026-10-17T17:55:30.454Z"
resolutionType: "code-change"
resolutionDetail: "readTree keys artifacts by relative(base, full).split(sep).join(\"/\"), so the .cache/ and history/ filters hold on Windows; zones.json assertion kept. Commit 755c1fbfd."
acceptanceCriteria:
  - "The artifact filter in terraform-infrastructure-model.test.ts excludes .cache and history entries whether the path uses / or \\"
  - "The test passes in Tests (Windows, rex+sourcevision) and still passes on Linux and macOS"
  - "The comparison still asserts zones.json is among the compared artifacts"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix; required check Tests (Windows, rex+sourcevision), run 39028377207.** Review: https://github.com/en-dash-consulting/n-dx/pull/825#pullrequestreview-5559040931 (CI section, \"Windows path filter\").\n\nAt the #825 head, `packages/sourcevision/tests/integration/terraform-infrastructure-model.test.ts:177` (from #780) filters the analysis artifacts with `!path.startsWith(\".cache/\") && !path.startsWith(\"history/\")`. On Windows the artifact paths are `.cache\\…` and `history\\…`, so the timing caches are not filtered out, get compared between the with-pack and without-pack runs, and differ.\n\nFix: normalise each path's separators to `/` (e.g. `path.split(sep).join(\"/\")` or `replaceAll(\"\\\\\", \"/\")`) before the `startsWith` checks, covering both `.cache/` and `history/`. If the artifact map is built by a helper in the test, normalising the keys there is fine too. Keep the `DATA_FILES.zones` assertion at line 179."
lastModified: "2026-10-17T17:55:30.811Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
