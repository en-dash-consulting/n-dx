---
id: "cb238ec9-5e06-4556-8fc7-2a0ef2d61d63"
type: "task"
title: "Claude CLI deny rule misses an abbreviated security find-generic-password"
slug: "claude-cli-deny-rule-misses-an"
description: "Follow-up to 9f3391dc. hench's command guard now resolves `security` abbreviations: SecurityTool runs the first table entry that the word is a prefix of, so `f`, `find` and `find-generic` all run find-generic-password. The Claude CLI deny rule `Bash(security find-generic-password:*)` (buildDisallowedTools, claude-cli-adapter) is a literal prefix, so `security find-generic -w` passes it. A per-prefix rule such as `security f:*` would also deny find-certificate and find-key. Decide how to close this, or document it as a known gap next to the interpreter gap."
acceptanceCriteria:
  - "Either the Claude CLI denies every spelling SECURITY_COMMANDS in hench guard/commands.ts resolves to find-generic-password, or docs and the adapter comment record the gap"
  - "security list-keychains and security find-certificate stay allowed under the Claude CLI"
priority: "high"
tags:
  - "credential-store"
  - "hench"
  - "security"
---
