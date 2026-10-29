---
id: "7ee5c876-10a1-4aed-bafd-a3a360fd0832"
type: "task"
title: "On POSIX an extension command runs detached in its own session: SIGHUP orphans it and it has no controlling tty"
slug: "on-posix-an-extension-command-runs"
description: "Verdict: should-fix (reasoned, POSIX only; Windows unaffected). handleExtensionCommand disposes n-dx's signal handlers, treeKillSpawnOptions gives detached:true (setsid), and FORWARDED_SIGNALS is SIGINT/SIGTERM only. Closing the terminal kills ndx with no cleanup while the extension keeps running; anything it spawns that opens /dev/tty (ssh passphrase or host-key prompt in a git clone, sudo, gpg) fails; Ctrl+Z stops only ndx. Fix (recommended): spawn extension commands non-detached on POSIX like a shell would and forward SIGTERM/SIGHUP by pid (the timeout group-kill no longer applies once D2 lands); minimal alternative: forward SIGHUP."
acceptanceCriteria:
  - "On POSIX an extension command shares the terminal's session and can open /dev/tty"
  - "SIGHUP to ndx reaches the extension"
  - "Behaviour on Windows is unchanged"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
