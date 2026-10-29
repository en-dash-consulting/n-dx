---
id: "b9282e5e-a7b3-4936-8b3a-b6c32e40f944"
type: "change"
title: "An operator can deny SSH_AUTH_SOCK and GIT_ASKPASS to the agent's commands"
slug: "an-operator-can-deny-ssh-auth-sock-and"
intent: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding I (medium, should-fix; out-of-scope (pre-existing), its own change).\n\nFailure scenario: packages/llm-client/src/child-env.ts:85 checks the allow list first and always merges DEFAULT_ENV_ALLOW, which includes SSH_AUTH_SOCK and GIT_ASKPASS, so compileEnvPolicy({deny: [\"SSH_AUTH_SOCK\", \"GIT_ASKPASS\"]}) still allows both. The agent's shell keeps the operator's ssh-agent and can push or ssh anywhere the operator can, and the operator has no way to turn that off.\n\nProbed: both names allowed after an explicit deny.\n\nOptions: an explicit deny of an exact name beats the defaults' allow; or make SSH_AUTH_SOCK opt-in. Recommended: exact-name deny wins (no behaviour change for anyone who has not asked)."
acceptanceCriteria:
  - "An exact name in guard.env.deny is stripped even when DEFAULT_ENV_ALLOW lists it"
  - "Test: denying SSH_AUTH_SOCK removes it from run_command's environment; the test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
