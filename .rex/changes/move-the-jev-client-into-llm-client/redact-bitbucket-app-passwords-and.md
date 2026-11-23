---
id: "1e1c6313-e0fb-4bbc-b7ab-8d0880792e69"
type: "task"
title: "Redact Bitbucket app passwords and access tokens"
slug: "redact-bitbucket-app-passwords-and"
description: "Extend llm-client/src/redact.ts with Bitbucket Cloud and Data Center credential patterns alongside the GitHub ones."
acceptanceCriteria:
  - "Bitbucket app passwords and access tokens are redacted in run records and logs (unit tests with sample values)"
  - "Existing GitHub token redaction tests still pass"
priority: "medium"
tags:
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
---
