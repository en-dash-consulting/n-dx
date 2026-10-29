---
id: "079c13ae-3179-49bd-a4cc-783a29b8ef6d"
type: "change"
title: "The default credential deny list covers the common names it misses"
slug: "the-default-credential-deny-list"
intent: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding H (medium, should-fix; out-of-scope (pre-existing, child-env.ts:31-48 unchanged by the stack), its own change).\n\nFailure scenario: names shaped like these pass the default policy and reach every sanitized child: *_PAT, *_KEY without API, *_KEYS, *_PASS, *PWD*, *JWT*, *_DSN, *SESSION* credentials (password-manager sessions), *_WEBHOOK_URL, DATABASE_URL, a lowercase api_key, and service-role keys.\n\nProbed: a fake variable of each shape survived compileEnvPolicy's defaults.\n\nOption: extend DEFAULT_ENV_DENY with those patterns, carving out known plumbing (e.g. session variables a terminal or desktop needs) explicitly; each new pattern gets a test. Risk: a tool that needed one of them now needs a guard.env.allow entry, which the changeset says."
acceptanceCriteria:
  - "The default deny list strips each of the listed name shapes, with any plumbing exceptions named and tested"
  - "Test: a sentinel variable of each shape is absent from a sanitized child environment; the test fails on the code before the fix"
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
