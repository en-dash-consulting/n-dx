---
id: "8a92c826-c075-4e0b-8140-96c8b46f385c"
type: "change"
title: "Extend the repository trust digest"
slug: "extend-the-repository-trust-digest"
intent: "collectRepoExecutionConfig digests hench.guard, permissionMode, provider, the test command and .mcp.json only. Several tracked files can widen execution outside that set. Add them to the digest and have readers ignore them from tracked files while the repository is restricted."
acceptanceCriteria:
  - "The digest covers .claude/settings.json, .claude/hooks/**, .codex/config.toml, hench autonomous, autoCommit, skipFullTestGate and apiKeyEnv, llm.*.cli_path, claudePath, llm.*.api_endpoint, llm.local.host, web.auth and every PRD run block, each with a warning finding when it widens"
  - "While restricted, readers ignore cli_path, claudePath, api_endpoint, local.host and web.auth from tracked files and only honour them from .n-dx.local.json or the user config, and an env-sourced API key is never sent to a non-default endpoint"
  - "The secret-paths-unblocked finding is a warning so removing the .env and key blocks restricts the checkout"
  - "A test asserts that changing each digested file or key changes the digest and moves a trusted checkout to changed"
priority: "high"
source: "ndx-capture"
---
