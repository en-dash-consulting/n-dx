---
id: "f771e5ca-0ad1-451f-9032-e2baba69e61d"
type: "capability"
title: "Source Vision Build and Config Artifact Classification"
slug: "source-vision-build-and-config"
statement: "Source Vision classifies build and configuration artifacts separately from core source logic when it scans a project."
criteria: [{"id":"c1","text":"When Source Vision scans a project that includes build or configuration artifacts, Source Vision shall classify those artifacts as build or configuration artifacts rather than as core source logic."},{"id":"c2","text":"When Source Vision generates analysis results, Source Vision shall keep artifacts that are not core source logic out of the source logic analysis."}]
priority: "high"
---

Type: Bug. Improve Source Vision classification so build and configuration artifacts are not incorrectly treated as core source logic.

User Story: As an N-DX user, I want Source Vision to classify build and configuration artifacts correctly, so that analysis results are accurate and useful.

Acceptance Criteria:
- Given a repository includes build or configuration artifacts, when Source Vision scans the project, then those artifacts are classified appropriately.
- Given artifacts are not core source logic, when results are generated, then they are separated from source logic analysis.
- Given classification rules are updated, when a project is rescanned, then source analysis becomes less noisy.

Notes: Should be considered alongside vendor artifact exclusion.
