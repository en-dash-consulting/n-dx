---
id: "db3c0066-8696-45bd-a77a-1c518bfe0221"
type: "task"
title: "Under codex auth api, the key does not reach the Codex agent's shell commands"
slug: "under-codex-auth-api-the-key-does-not"
description: "Codex half of 82ff7e46. resolveVendorCliEnv puts the key (config, env, store or helper) into the codex child's OPENAI_API_KEY under llm.codex.auth api, and sets nothing comparable to Claude's CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. Whether Codex's shell tool passes OPENAI_API_KEY on depends on its shell_environment_policy (default excludes for *KEY*/*SECRET*/*TOKEN*, ignore_default_excludes, inherit), which n-dx does not set and the user's ~/.codex/config.toml can widen. Not verified in 82ff7e46 (Codex docs fetch was unavailable). Verify the current defaults at https://developers.openai.com/codex/config-advanced, then force the exclusion with a -c override on every codex exec spawn (compileCodexPolicyFlags in packages/llm-client/src/codex-cli-provider.ts and hench's codex spawn), or document why it is unnecessary. Update the \"Where a key enters a child environment\" paragraph in docs/guide/configuration.md."
acceptanceCriteria:
  - "Under llm.codex.auth api, a command the Codex agent runs cannot read OPENAI_API_KEY from its environment, whatever the user's Codex config sets"
  - "The codex child still authenticates with the key"
  - "docs/guide/configuration.md states the Codex behaviour accurately"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
  - "hench"
  - "security"
source: "follow-up of 82ff7e46"
---
