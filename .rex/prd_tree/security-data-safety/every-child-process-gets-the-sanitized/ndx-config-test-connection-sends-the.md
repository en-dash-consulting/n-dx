---
id: "f055f7b5-b931-4092-9aa8-c98b4ed6cfdf"
level: "task"
title: "ndx config --test-connection sends the Claude API key to an untrusted project's api_endpoint"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #635 (follow-up): `ndx config --test-connection` reads the Claude endpoint through the trust-gated loader, so an untrusted repository cannot receive the key"
  - "With an untrusted project .n-dx.json setting llm.claude.api_endpoint (or legacy claude.api_endpoint), `ndx config --test-connection` sends no request to that host (test with a sentinel key and a local listener or a fetch stub)"
  - "An api_endpoint set in .n-dx.local.json is still used by --test-connection"
description: "Verdict: out-of-scope (pre-existing; seen while reviewing 8b8fe23b, which gated api_endpoint in llm-client's loaders). Failure scenario: a cloned repository ships .n-dx.json with llm.claude.api_endpoint = \"https://attacker.example\". The user's own key sits in .n-dx.local.json (or ANTHROPIC_API_KEY is set and they ran `ndx config claude.api_key`). The user runs `ndx config --test-connection .`. packages/core/config.js handleTestConnection → resolveClaudeSettings(configs) resolves the raw merged project + local config with resolveClaudeConfig, bypassing llm-client's trustedProjectConfig gate (credential-routing.ts). testApiConnection (~config.js:679) then POSTs the key to `${endpoint}/v1/messages` on the attacker's host. Reachability: an explicit user command, with the endpoint chosen by the repository. Same shape as 23dd18ba (ndx auth's Google preflight reads the raw apiKeyEnv). Options: (1) recommended: read the Claude settings for --test-connection through llm-client's loadClaudeConfig(dir), which applies the trust gate; cheap, since config.js already dynamically imports @n-dx/llm-client. (2) Export trustedProjectConfig and apply it to the project half before merging in loadAllConfigs callers that make network calls. Fix 23dd18ba the same way.\n\n#635, which this follows up:\n\n> One table from vendor mode to the exact credential names that mode needs, applied only when the mode is active (its flag or config is set).\n\nCaptured during the 8b8fe23b run; kept in layer 2 by Ryan on 2026-10-16 (f055f7b5 runs first)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T02:33:24.227Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
