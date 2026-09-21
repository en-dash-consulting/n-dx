---
id: "b180b915-2dd1-45dc-bfdc-681ac87d8cbd"
level: "task"
title: "Fix code in sourcevision-view-tests: Coupling score 0.75 is produced entirely by false-positive string-literal edges,"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:21:36.154Z"
completedAt: "2026-04-14T01:27:08.447Z"
acceptanceCriteria: []
description: "- Coupling score 0.75 is produced entirely by false-positive string-literal edges, while the real architectural risk (white-box leaf-path imports into web-viewer internals) is unrepresented in the metric. Zone tooling that gates on coupling score will raise a false alarm for the wrong reason while the true refactor trap goes undetected."
recommendationMeta: "[object Object]"
---
