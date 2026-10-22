---
id: "23dd18ba-59a6-4e42-bdaa-fe1a9072f7db"
level: "task"
title: "ndx auth's Google preflight reads llm.google.apiKeyEnv from the untrusted project config"
status: "completed"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
source: "hench-follow-up"
startedAt: "2026-10-17T03:41:54.700Z"
completedAt: "2026-10-17T03:48:33.047Z"
endedAt: "2026-10-17T03:48:33.047Z"
resolutionType: "code-change"
resolutionDetail: "core/config.js Google preflight reads apiKeyEnv/api_key via llm-client loadLLMConfig(dir) (trust-gated); failure message names the variable actually read. e2e tests in tests/e2e/cli-auth.test.js."
acceptanceCriteria:
  - "Closes #635 (follow-up): `ndx auth`'s Google preflight reads apiKeyEnv through the trust-gated loader"
  - "An untrusted project's llm.google.apiKeyEnv does not choose which variable ndx auth's Google preflight sends (test with a sentinel value)"
  - "The same field in .n-dx.local.json still applies"
description: "Seen while fixing 8b8fe23b. packages/core/config.js runGoogleApiPreflight (ndx auth, ndx init / ndx config llm.vendor google) takes apiKeyEnv from the raw merged configs.llm, not through llm-client's loadLLMConfig, so it bypasses the credential-routing trust gate (packages/llm-client/src/credential-routing.ts). It sends process.env[apiKeyEnv] to the fixed generativelanguage.googleapis.com host, and only after an AIza/AQ key-format check, so a GITHUB_TOKEN cannot get through. A different Google key the user holds could still be sent. Fix: resolve the preflight's apiKeyEnv (and any endpoint) through loadLLMConfig(dir), or the same trustedProjectConfig gate.\n\n#635, which this follows up:\n\n> One table from vendor mode to the exact credential names that mode needs, applied only when the mode is active (its flag or config is set).\n\nCaptured during the 8b8fe23b run; kept in layer 2 by Ryan on 2026-10-16 (f055f7b5 runs first)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T03:48:33.317Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
