---
id: "68ddc78a-5fd2-4103-a739-63b00aeea890"
type: "change"
title: "hench's vendor CLI sandbox lets the Claude CLI read its keychain login on macOS 14"
slug: "hench-s-vendor-cli-sandbox-lets-the"
summary: "Autonomous runs on macOS fail before they start because the safety sandbox blocks a system cache the Claude sign-in needs. Open that one cache folder to the Claude CLI, and say plainly when the sandbox is what broke the sign-in."
intent: "Found 2026-11-04 running ndx work from a build of main 52080e214 on macOS 14 (Darwin 23.0.0). Every Claude CLI run fails before its first turn with 'Not logged in · Please run /login' or 'Authentication required · Sign in again to continue', and the task is marked deferred with the unclassified verdict \"No recorded signal explains this run's failure.\" The same claude binary outside the sandbox answers normally, and `ndx auth` / `claude auth status` pass. Seen again 2026-11-16 on 0.10.3 from a plain terminal, so it is not the desktop session's leaked environment.\n\n**Cause (found 2026-11-24 on 3de0afbd9, released as 0.10.5).** Not the account and not CLAUDE_CONFIG_DIR. Every Keychain lookup (`security`, SecItem) opens the Security framework's per-user MDS cache, `$(getconf DARWIN_USER_CACHE_DIR)mds` (`mds.lock`, `mdsDirectory.db`, under `/private/var/folders/…/C/mds`), for read AND write. The vendor-cli profile (createVendorCliSandbox in packages/hench/src/guard/sandbox.ts, buildSeatbeltProfile in packages/llm-client/src/sandbox.ts) reaches ~/Library/Keychains and the securityd services but leaves /private/var/folders read-only, so the lookup fails with 'A Module Directory Service error has occurred' and the CLI reports it is not logged in. The earlier guess (/private/var/db/mds, /Library/Security) was wrong.\n\nEvidence: `claude auth status` run inside the profile hench builds, for a config folder signed in outside it, reports `loggedIn: false` as built; adding `(allow file-read* file-write* (subpath \"<cache>/mds\"))` and nothing else gives `loggedIn: true`; write-only on that folder, or read-everything, still gives false.\n\n**Second defect.** A sign-in failure inside the sandbox is reported as invalid or expired credentials and the task is left deferred, so the operator re-authenticates a login that is fine. The verdict should name the sandbox as the cause and leave the task pending.\n\nOperator workarounds until fixed: `claude setup-token` and pass the token as CLAUDE_CODE_OAUTH_TOKEN (hench keeps that variable for the CLI), which keeps the sandbox on; or NDX_SANDBOX=off, which runs the agent's commands unconfined."
acceptanceCriteria:
  - "On macOS, a Claude CLI spawned inside hench's vendor sandbox with a Keychain login reads it and completes a turn"
  - "Only the real path of $(getconf DARWIN_USER_CACHE_DIR)mds is added read-write, for the vendor CLI profile only; tool sandboxes and the rest of /private/var/folders are unchanged"
  - "The keychain directory stays read-only to the confined process and no other credential directory is opened"
  - "A sign-in failure inside a confined run names the sandbox as the likely cause instead of invalid or expired credentials, and leaves the task pending rather than deferred"
  - "A macOS-only test runs a keychain lookup (or claude auth status) inside the vendor-cli profile"
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
