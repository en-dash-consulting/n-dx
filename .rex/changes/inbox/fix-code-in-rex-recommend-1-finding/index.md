---
id: "f439f940-24bc-46a2-b7bd-9fe6021af6d3"
type: "change"
title: "Fix code in rex-recommend (1 finding)"
slug: "fix-code-in-rex-recommend-1-finding"
intent: "- Add unit tests for recommend/similarity.ts (140 lines, zero tests). At minimum, test the core similarity scoring function with known inputs and expected outputs, edge cases (empty inputs, exact duplicates, zero-similarity pairs). similarity.ts is the only substantial untested implementation file in the recommend zone and is on the critical path for recommendation quality — a logic error here produces incorrect recommendations with no test catching it."
priority: "high"
source: "sourcevision"
---
