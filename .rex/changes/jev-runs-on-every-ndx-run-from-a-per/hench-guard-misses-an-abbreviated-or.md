---
id: "9f3391dc-0852-463d-b0a0-f89f23cfad68"
type: "task"
title: "hench guard misses an abbreviated or other-cased security find-generic-password"
slug: "hench-guard-misses-an-abbreviated-or"
description: "Adversarial review of 8f7cb2f8 (should-fix, high). assertNotCredentialCommand (packages/hench/src/guard/commands.ts) now matches `find-generic-password` anywhere after `security`, but only as an exact word. If macOS `security` resolves a unique prefix of a subcommand (its command table lookup in SecurityTool's security.c is believed to match by prefix) or ignores case, then with `security` in guard.allowedCommands, `security find-generic -s X -w` or a similar spelling still runs the keychain read. Not verified on this host: running `security` needed approval during the automated review. Reachable through run_command whenever a user allows `security`.\n\nOptions: (a) verify on macOS which spellings `security` accepts, then refuse any word that is a prefix (length ≥ the shortest unambiguous one) of find-generic-password, case-folded if needed; cheap, and keeps other subcommands allowed. (b) Refuse `security` outright while it is denied (simple, but blocks list-keychains and similar). Recommend (a) after verifying."
acceptanceCriteria:
  - "Which abbreviations and casings of find-generic-password macOS security executes is recorded in the guard's comment"
  - "With security in guard.allowedCommands, the guard refuses every spelling security executes as find-generic-password, with a unit test per spelling"
  - "security list-keychains and security find-certificate still pass"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "credential-store"
  - "hench"
  - "security"
source: "ndx-adversarial-review"
---
