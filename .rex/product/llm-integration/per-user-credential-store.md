---
id: "2c0a3e60-2840-4695-8aee-fb720b6f9a1e"
type: "capability"
title: "Per-user credential store"
slug: "per-user-credential-store"
statement: "n-dx keeps credentials it must hold itself (the TypeSafe key now, vendor API keys later) in one owner-only store in the user's ndx home, shared by every project and worktree, so Jev and the other callers find a key without it being exported or passed through a child process environment."
criteria: [{"id":"c1","text":"An exported TYPESAFE_API_KEY shall take precedence over the key in the credential store."},{"id":"c2","text":"Storing a vendor key shall never switch that vendor off its CLI login."},{"id":"c3","text":"Test suites shall run against a temporary ndx home, so no test reads the user's real credential store."},{"id":"c4","text":"A helper command shall store a credential in a file only its owner can read or write."}]
---

## History

- 2026-11-07 7d8853e2-2aaa-4ee5-aa15-9d4d14400905 added: Jev runs on every ndx run from a per-user credential store
