---
id: "1e1c6313-e0fb-4bbc-b7ab-8d0880792e69"
level: "task"
title: "Redact Bitbucket app passwords and access tokens"
status: "in_progress"
priority: "medium"
tags:
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-06T08:20:34.872Z"
acceptanceCriteria:
  - "Bitbucket app passwords and access tokens are redacted in run records and logs (unit tests with sample values)"
  - "Existing GitHub token redaction tests still pass"
description: "Extend llm-client/src/redact.ts with Bitbucket Cloud and Data Center credential patterns alongside the GitHub ones."
lastModified: "2026-10-06T08:20:35.302Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
