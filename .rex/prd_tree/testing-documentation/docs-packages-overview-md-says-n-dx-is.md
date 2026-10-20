---
id: "076bb8b6-aab9-4c8e-840a-e142a5e43cf1"
level: "task"
title: "docs/packages/overview.md says n-dx is six packages; it publishes fifteen"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "docs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "docs/packages/overview.md states no fixed package count, or a count equal to the published packages/* count"
  - "The overview names lang-kit, lang-runtime, the lang-* packs, graview and graview-face"
description: "Verdict: out-of-scope (low), pre-existing. Found during the adversarial review of 6f6a9102 (the OPEN_SOURCE_SCOPE.md fix). docs/packages/overview.md:3 reads \"n-dx is composed of six packages in a strict dependency hierarchy\", and its diagram shows only core, hench, rex, sourcevision and llm-client. packages/* publishes 15 @n-dx packages (lang-kit, lang-runtime, five lang-* packs, graview, graview-face, web, plus the original six), all of them in the .changeset/config.json fixed group. A docs-site reader therefore gets the wrong package count. The tests/e2e/prompt-section-parity.test.js \"all 6 packages\" check may encode the same count and should be checked alongside. Recommended fix: drop the count, point to .changeset/config.json as RELEASING.md does, and add the language packages and graview to the diagram. It is cheap, the edit is docs-only, and the parity test needs a look."
lastModified: "2026-10-17T10:38:09.507Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
