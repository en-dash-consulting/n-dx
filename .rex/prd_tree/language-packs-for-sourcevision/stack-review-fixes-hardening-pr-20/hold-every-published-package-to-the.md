---
id: "6f6a9102-0c7f-445e-a3fb-541d9339c3c9"
level: "task"
title: "Hold every published package to the release group, and list them in OPEN_SOURCE_SCOPE.md"
status: "pending"
priority: "medium"
tags:
  - "review-fixes"
  - "release"
  - "docs"
  - "pr-20"
source: "review"
acceptanceCriteria:
  - "fixed-group-versions.test.js fails naming any non-private workspace package missing from the fixed group"
  - "OPEN_SOURCE_SCOPE.md lists every published package (checked against package.json private/license) and no longer says six"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Two findings from the review of f75edb08 (PR 15).\n\n1. **Missing reverse check (2cb34654).** RELEASING.md now says every @n-dx/* package shares the fixed-group version and that a new package joins the group in .changeset/config.json. But tests/e2e/fixed-group-versions.test.js checks only one direction: every name in the group is a workspace package, and the group shares one version. Someone adding packages/lang-rust (a new, non-private @n-dx/lang-rust) without updating config.json leaves every test green; changesets then versions the package on its own and RELEASING.md is false. Fix: add a case that every non-private workspace package is in some fixed group, failing with the missing names.\n\n2. **OPEN_SOURCE_SCOPE.md (0808fbc1).** Line 24 says \"All six packages share a single version line\", and its Included components table lists only core, sourcevision, rex, hench, llm-client and web. The fixed group and packages/* also hold lang-kit, lang-runtime, lang-java, lang-go, lang-sql, lang-terraform, lang-python, graview and graview-face, all published under Elastic-2.0, so a reader checking licensing scope would not see nine published packages. Fix: replace \"six\" with a pointer to .changeset/config.json, as RELEASING.md now does, and add the missing packages to the table. Check each one's license field and its private flag first; list only published packages."
lastModified: "2026-10-17T09:21:40.095Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
