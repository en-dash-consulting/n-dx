---
id: "bcc8d2de-752a-4f01-ad59-18b4be58a61f"
type: "capability"
title: "Source Vision Vendor Artifact Exclusion"
slug: "source-vision-vendor-artifact-exclusion"
statement: "Source Vision leaves vendor artifacts out of source logic classification and source analysis, and keeps relevant source files in its scan."
criteria: [{"id":"c1","text":"When a repository includes vendor artifacts and Source Vision scans the project, Source Vision shall exclude the vendor artifacts from source logic classification."},{"id":"c2","text":"When Source Vision generates scan results and has detected excluded artifacts, Source Vision shall leave those artifacts out of the source analysis so that they do not inflate or distort it."},{"id":"c3","text":"When Source Vision applies exclusion rules and the scan completes, Source Vision shall keep relevant source files in the scan results."}]
priority: "high"
---

Type: Bug. Prevent vendor artifacts from being scanned or classified as source logic in Source Vision.

User Story: As an N-DX user, I want vendor artifacts excluded from Source Vision analysis, so that generated insights focus on relevant source code.

Acceptance Criteria:
- Given a repository includes vendor artifacts, when Source Vision scans the project, then vendor artifacts are excluded from source logic classification.
- Given excluded artifacts are detected, when scan results are generated, then they do not inflate or distort source analysis.
- Given exclusion rules are applied, when the scan completes, then relevant source files remain included.

Notes: May align with broader Source Vision classification cleanup.
