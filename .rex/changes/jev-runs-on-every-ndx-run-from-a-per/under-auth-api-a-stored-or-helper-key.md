---
id: "82ff7e46-365c-4284-a74d-83753ed94067"
type: "task"
title: "Under auth api, a stored or helper key does not reach the agent's shell environment"
slug: "under-auth-api-a-stored-or-helper-key"
description: "Should-fix from the #949 review. resolveVendorCliEnv in packages/llm-client/src/child-env.ts (~line 315, env[keyName] = key.value) puts a stored or helper key into the Claude CLI child's ANTHROPIC_API_KEY under llm.claude.auth api. Claude Code passes its environment to its Bash tool and nothing sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, so a hench agent can run `printenv ANTHROPIC_API_KEY` — the store-path and helper-command deny rules are moot for exactly the keys they protect. The #949 description says helper values never go into any child environment. Options: hand the Claude CLI the key through its own apiKeyHelper setting so the value never enters the environment; or set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 for hench runs; at minimum, correct the docs (docs/guide/configuration.md) and list it as a known gap. Codex needs the equivalent analysis."
acceptanceCriteria:
  - "Under llm.claude.auth api with a stored or helper key, a command the agent runs through Claude Code's Bash tool cannot read the key from its environment"
  - "The Claude CLI child still authenticates with the stored or helper key under auth api"
  - "docs/guide/configuration.md states accurately whether and where a stored key enters a child environment"
priority: "high"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
  - "hench"
  - "security"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
