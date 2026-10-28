---
id: "22fb3f27-2ae8-43b2-928e-649f1da131d0"
type: "task"
title: "hench.apiKeyEnv is credential routing: gated until trusted and part of the digest"
slug: "hench-apikeyenv-is-credential-routing"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding J (low, should-fix; cheap, so in the stack; found by two passes).\n\nFailure scenario: a repository's .hench/config.json sets apiKeyEnv to the name of an unrelated credential. hench's API loop (packages/hench/src/agent/lifecycle/loop.ts:312) sends that variable's value as the Anthropic API key. The field is neither gated nor in the digest, the same choice credential-routing.ts gates for llm.google.apiKeyEnv. The endpoint itself is gated, so the value goes to Anthropic or the user's own endpoint, not to the repository.\n\nOption: add hench.apiKeyEnv to CREDENTIAL_ROUTING_FIELDS (or the hench collector) so a repository value is ignored until trusted and changes the digest."
acceptanceCriteria:
  - "Closes #686 (follow-up): a repository cannot choose which variable hench sends as its API key until the checkout is trusted"
  - "A repository-supplied hench.apiKeyEnv raises a credential-routing finding, enters the digest, and is ignored while restricted; the same field in an untracked .n-dx.local.json still applies"
  - "Test: an untrusted checkout setting apiKeyEnv to a sentinel name sends the default variable instead; the test fails on the code before the fix"
priority: "low"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
