---
id: "742863c5-989f-4138-8909-9b59bb589fc4"
type: "task"
title: "C2a: ndx config credentials.typesafe stores the key with a hidden prompt, --stdin, --unset and status"
slug: "c2a-ndx-config-credentials-typesafe"
description: "PR 1. Add a user-scoped credentials namespace to ndx config (packages/core/config.js). config.js is orchestration tier: it does the TTY prompt and spawns llm-client's dist/cli/credentials.js with the value on stdin, never imports a package and never puts the value on argv. Only typesafe in this PR; the llm.*.api_key alias, the .n-dx.local.json import (C2b) and --test (C6) come later."
acceptanceCriteria:
  - "ndx config credentials prints name, backend, source in effect and fingerprint, never the value, and says the namespace is per-user and the directory argument is ignored"
  - "ndx config credentials.typesafe prompts with echo off on a TTY; --stdin reads a piped value; a value on argv is accepted with a warning about shell history and ps; --unset removes the entry"
  - "Any other credentials.<name> is refused with a message that vendor keys come in a later release"
  - "config.js reaches the store only by spawning llm-client's dist/cli/credentials.js with the value on stdin; domain-isolation and architecture-policy tests pass"
  - "An e2e test with a temp N_DX_HOME shows the store file 0600 in a 0700 dir after a set, and the placeholder appears in no stdout, stderr or log"
  - "ndx config llm.claude.api_key behaves exactly as on main, and ndx config --help documents credentials"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
