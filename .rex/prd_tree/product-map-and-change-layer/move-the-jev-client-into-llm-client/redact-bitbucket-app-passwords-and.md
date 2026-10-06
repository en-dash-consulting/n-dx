---
id: "1e1c6313-e0fb-4bbc-b7ab-8d0880792e69"
level: "task"
title: "Redact Bitbucket app passwords and access tokens"
status: "completed"
priority: "medium"
tags:
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-06T08:20:34.872Z"
completedAt: "2026-10-06T08:41:05.526Z"
endedAt: "2026-10-06T08:41:05.526Z"
resolutionType: "code-change"
resolutionDetail: "Added Bitbucket/Atlassian prefixed token shapes (ATBB, ATCTT, ATATT, BBDC-) to redact.ts, plus two rules for the shapeless forms an app password travels in: Authorization: Basic <base64> and the -u/--user user:password flag. 8 new unit tests; all 14 pre-existing redaction tests (GitHub included) unchanged and passing. Also fixed a pre-existing bug where redactSecretsDetailed().kinds listed a kind twice when two rules of that kind fired."
acceptanceCriteria:
  - "Bitbucket app passwords and access tokens are redacted in run records and logs (unit tests with sample values)"
  - "Existing GitHub token redaction tests still pass"
description: "Extend llm-client/src/redact.ts with Bitbucket Cloud and Data Center credential patterns alongside the GitHub ones."
lastModified: "2026-10-06T08:41:05.957Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
