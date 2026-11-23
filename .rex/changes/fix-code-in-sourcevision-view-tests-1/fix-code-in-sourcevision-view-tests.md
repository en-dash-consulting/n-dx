---
id: "b180b915-2dd1-45dc-bfdc-681ac87d8cbd"
type: "task"
title: "Fix code in sourcevision-view-tests: Coupling score 0.75 is produced entirely by false-positive string-literal edges,"
slug: "fix-code-in-sourcevision-view-tests"
description: "- Coupling score 0.75 is produced entirely by false-positive string-literal edges, while the real architectural risk (white-box leaf-path imports into web-viewer internals) is unrepresented in the metric. Zone tooling that gates on coupling score will raise a false alarm for the wrong reason while the true refactor trap goes undetected."
priority: "high"
source: "sourcevision"
---
