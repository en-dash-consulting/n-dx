---
id: "64e133c5-7ea1-462f-9a73-11fbd3b1658b"
level: "task"
title: "hench's missing-credentials message tells a Codex env_key user the CLI falls back to default credential files"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #635 (follow-up): the missing-credentials report is accurate for every mode in the table"
  - "With a Codex env_key mode active and its variable unset, the hench log line does not claim a fallback to default credential files (test)"
  - "The Claude Vertex missing-credentials case still logs exactly one line naming GOOGLE_APPLICATION_CREDENTIALS (existing integration test, updated wording)"
  - "The documentation links cited in child-env.ts and codex-user-config.ts resolve: Gemini CLI auth is docs/get-started/authentication.mdx in google-gemini/gemini-cli (with the README section that documents GOOGLE_GENAI_USE_VERTEXAI), and the Codex provider docs are https://developers.openai.com/codex/config-advanced (the old docs/config.md#model_providers anchor no longer exists)"
description: "Verdict: should-fix (low). Failure scenario: the user's ~/.codex/config.toml selects an Azure provider whose env_key names AZURE_OPENAI_API_KEY, and that variable is not exported. resolveVendorCliEnv (packages/llm-client/src/child-env.ts, VENDOR_MODES Codex row) reports it as missing-credentials. hench/src/agent/lifecycle/cli-loop.ts:2372-2378 then logs \"cloud mode is on but none of AZURE_OPENAI_API_KEY is set; the CLI falls back to default credential files or instance metadata\". Codex has no such fallback for a provider env_key, so the run fails with an auth error that the log has just explained away. Reachable on every `ndx work` Codex run where this happens. Introduced by the mode table (56517553), which feeds new modes into the old Claude-cloud wording. Options: (a) make the wording mode-neutral (\"a vendor mode is on but none of X is set\") and drop the fallback claim (cheap; the hench integration test in tests/integration/vendor-cli-env.test.ts asserts the old phrase, so update it); (b) give each VENDOR_MODES row its own fallback text and pass it through onStripped (more precise, but widens the callback contract). Recommend (a).\n\nAlso fixes the two dead documentation links T5 cited (found when the session checked them on 2026-10-16): https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md returns 404 (now authentication.mdx; GOOGLE_GENAI_USE_VERTEXAI is documented in the README), and https://github.com/openai/codex/blob/main/docs/config.md#model_providers now only points to https://developers.openai.com/codex/config-advanced.\n\n#635, which this follows up:\n\n> One table from vendor mode to the exact credential names that mode needs, applied only when the mode is active (its flag or config is set).\n\nCaptured during the T5 run (56517553); kept in layer 2 by Ryan on 2026-10-16, to run after T4."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T22:51:16.073Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
