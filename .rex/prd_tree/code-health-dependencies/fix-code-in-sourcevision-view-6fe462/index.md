---
id: "6fe462af-722d-4fb6-b082-2f9ab301c2d7"
level: "feature"
title: "Fix code in sourcevision-view-tests (1 finding)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:27:08.622Z"
completedAt: "2026-04-14T01:27:08.622Z"
acceptanceCriteria: []
description: "- Coupling score 0.75 is produced entirely by false-positive string-literal edges, while the real architectural risk (white-box leaf-path imports into web-viewer internals) is unrepresented in the metric. Zone tooling that gates on coupling score will raise a false alarm for the wrong reason while the true refactor trap goes undetected."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix code in sourcevision-view-tests: Coupling score 0.75 is produced entirely by false-positive string-literal edges,](./fix-code-in-sourcevision-view-b180b9.md) | completed |
