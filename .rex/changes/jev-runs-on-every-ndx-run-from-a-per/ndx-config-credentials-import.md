---
id: "0e7c49f6-104a-4db7-83f1-7c1397cc7ba7"
type: "task"
title: "ndx config credentials --import overwrites a stored key or helper without asking when the store was refused"
slug: "ndx-config-credentials-import"
description: "Verdict: out-of-scope for afd1638b. It is pre-existing from the key-import guard task (ec955a6dd), and was found while reviewing afd1638b. Scenario: credentials.json is 0644 (or has an unreadable mode on POSIX) and holds a claude key, or a claude helper. .n-dx.local.json holds a different llm.claude.api_key. `ndx config credentials --import .` reads `status --json` and sees backend null for claude, because the refused store was not read. It therefore skips both the helper skip and the fingerprint confirmation, runs `credentials set claude`, and readStoreForWrite (which ignores the mode) replaces the stored key or helper with the file's plaintext key. The command prints 'Moved the claude key …' and nothing about the replacement. Location: packages/core/config.js importLocalApiKeys (the entry?.backend checks). Reachable through the documented --import flow and the TTY prompt in `ndx config credentials`. Since afd1638b, the status JSON carries storeProblem. Options: (A, recommended) when any status entry has a storeProblem, import nothing and print the problem and its fix; this costs one check and one e2e test. (B) Read the entries regardless of mode for the import decision; this weakens the refusal, so it is not recommended."
acceptanceCriteria:
  - "With a 0644 credentials.json holding a claude key and a different claude key in .n-dx.local.json, `ndx config credentials --import .` leaves the stored claude entry unchanged (e2e, POSIX)"
  - "The command names the store problem and the chmod fix, and the file key stays in .n-dx.local.json"
  - "No output contains either key value"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "credential-store"
source: "ndx-adversarial-review"
---
