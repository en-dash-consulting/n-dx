---
id: "94a33e07-b483-4b90-9b37-34911b54f084"
type: "task"
title: "auth cli drops API tokens that outrank the CLI login from the child environment"
slug: "auth-cli-drops-api-tokens-that-outrank"
description: "Should-fix from the #949 review. Under llm.<vendor>.auth cli, resolveVendorCliEnv in packages/llm-client/src/child-env.ts (~line 306, dropKeyName) removes only ANTHROPIC_API_KEY / OPENAI_API_KEY; ANTHROPIC_AUTH_TOKEN and CODEX_API_KEY stay in authNames and are copied to the child. Claude Code ranks ANTHROPIC_AUTH_TOKEN above the login and ANTHROPIC_API_KEY, and codex exec honours CODEX_API_KEY, so auth cli can still bill an API token despite the comment 'and nothing that would outrank it'. Under auth api, an exported ANTHROPIC_AUTH_TOKEN likewise shadows the chosen stored key. Pass-through confirmed by experiment; the CLIs' precedence is from vendor docs. Keep the session-login plumbing (CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR, CODEX_HOME, CODEX_ACCESS_TOKEN) as appropriate."
acceptanceCriteria:
  - "Under auth cli, the claude child receives no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in any casing"
  - "Under auth cli, the codex child receives no OPENAI_API_KEY or CODEX_API_KEY in any casing"
  - "Under auth api, no exported token that the CLI ranks above the chosen key reaches the child"
  - "Bedrock, Vertex and the CLI's own login plumbing are unchanged"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
