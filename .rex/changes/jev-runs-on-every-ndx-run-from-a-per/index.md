---
id: "7d8853e2-2aaa-4ee5-aa15-9d4d14400905"
type: "change"
title: "Jev runs on every ndx run from a per-user credential store"
slug: "jev-runs-on-every-ndx-run-from-a-per"
intent: "A per-user credential store (credentials.json in the ndx home) so Jev (TypeSafe) runs on every ndx run without exporting TYPESAFE_API_KEY, and vendor keys can be stored without moving a project off its CLI login. One store module in llm-client owns format, read, write, lock and owner-only permissions; the orchestration tier reaches it only by spawning it. Design: local-design-workshop docs/analysis/credential-injection (01 design, 02 re-ground, 03 capture proposal). PR 1 = T1-T5, PR 2 = T6-T8, PR 3 = T9-T11; T12 deferred."
acceptanceCriteria:
  - "An exported TYPESAFE_API_KEY still wins over the stored key"
  - "Storing a key never switches a vendor off CLI login"
  - "Tests isolate NDX_HOME, so no test reads the real store"
  - "A helper command stores the key with owner-only file permissions"
amends: [{"target":"2c0a3e60-2840-4695-8aee-fb720b6f9a1e","delta":"added","summary":"Jev runs on every ndx run from a per-user credential store","criteria":{"add":[{"id":"c1","text":"An exported TYPESAFE_API_KEY shall take precedence over the key in the credential store."},{"id":"c2","text":"Storing a vendor key shall never switch that vendor off its CLI login."},{"id":"c3","text":"Test suites shall run against a temporary ndx home, so no test reads the user's real credential store."},{"id":"c4","text":"A helper command shall store a credential in a file only its owner can read or write."}]},"proposed":"n-dx keeps credentials it must hold itself (the TypeSafe key now, vendor API keys later) in one owner-only store in the user's ndx home, shared by every project and worktree, so Jev and the other callers find a key without it being exported or passed through a child process environment.","under":"7b2bbeff-44de-4b1b-b164-54fb5ddcb5f3","title":"Per-user credential store","type":"capability"}]
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
source: "credential-injection-design"
---
