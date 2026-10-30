---
id: "94e25654-bb3c-4203-a1ab-49267e0ad734"
type: "task"
title: "C5: llm.<vendor>.auth cli, api or auto; a store-only key never selects api"
slug: "c5-llm-vendor-auth-cli-api-or-auto-a"
description: "PR 2. Done-when re-tightened against PR 1's merged code before PR 2 starts. New setting llm.<vendor>.auth set through ndx config. Vendor keys start being read from the store here, only under api. cli strips the vendor key from the CLI child env so Claude Code cannot prefer an exported ANTHROPIC_API_KEY over the subscription login."
acceptanceCriteria:
  - "llm.<vendor>.auth accepts cli, api and auto through ndx config"
  - "auto never selects api from a store-only key (test)"
  - "cli strips the vendor key env from the CLI child (test)"
  - "api with no key is a loud error naming ndx config credentials.<vendor>"
  - "diagnoseAuth reports the mode and the key's source, and credentials.claude, codex and google are accepted"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
