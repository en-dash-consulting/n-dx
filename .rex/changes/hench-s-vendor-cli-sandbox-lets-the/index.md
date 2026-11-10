---
id: "68ddc78a-5fd2-4103-a739-63b00aeea890"
type: "change"
title: "hench's vendor CLI sandbox lets the Claude CLI read its keychain login on macOS 14"
slug: "hench-s-vendor-cli-sandbox-lets-the"
intent: "Found 2026-11-04 running ndx work from a build of main 52080e214 on macOS 14 (Darwin 23.0.0). Every Claude CLI run fails before its first turn with 'Authentication required · Sign in again to continue' (runs e211c772 and a97bcf4a), and the task is marked deferred. The same claude binary outside the sandbox answers normally, and `ndx auth` passes.\n\nReproduced with createVendorCliSandbox (packages/hench/src/guard/sandbox.ts) wrapping `claude -p`: 'Not logged in'. Inside the same sandbox, `security find-generic-password -s \"Claude Code-credentials\"` fails with 'SecKeychainSearchCreateFromAttributes: A Module Directory Service error has occurred' (rc 44), while outside it finds the item. So the seatbelt profile (buildSeatbeltProfile in packages/llm-client/src/sandbox.ts, kind vendor-cli) gives read access to ~/Library/Keychains and the SecurityServer/secd/trustd mach services, but something keychain search needs on macOS 14 is still denied — likely read access to the MDS database (/private/var/db/mds/, /Library/Security) or another mach service. Check with `log stream --predicate 'sender == \"Sandbox\"'` while reproducing.\n\nThe global runner (ndx-runner at 0e2bbb7b8, before the sandbox landed in 2b16b07f0) is unaffected, which is how the 2026-11-04 credential-store follow-up runs were made. Operator workaround: NDX_SANDBOX=off. A vendor-CLI sandbox test that runs on a macOS host and checks `security find-generic-password` (or a real CLI login check) inside the profile would have caught this."
acceptanceCriteria:
  - "On macOS 14, a Claude CLI spawned inside hench's vendor sandbox reads its keychain login and completes a turn"
  - "Inside the vendor sandbox, security find-generic-password finds the Claude Code credentials item"
  - "The keychain stays read-only to the confined process and no other credential directory is opened"
  - "A macOS-only test exercises a keychain lookup inside the vendor-cli profile"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
fix: true
priority: "critical"
tags:
  - "hench"
  - "sandbox"
  - "macos"
source: "ndx work failure while running credential store review follow-ups (2026-11-04)"
---
