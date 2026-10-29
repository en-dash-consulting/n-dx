---
id: "76f0d280-28d7-4ef3-a086-36ded6465eca"
type: "task"
title: "n-dx checks for updates on every extension run and writes its notice into the extension's stderr"
slug: "n-dx-checks-for-updates-on-every"
description: "Verdict: should-fix (cheap). main() in packages/core/cli.js starts startUpdateCheck for every command and flushAndExit prints the notice on exit 0, so `ndx recon` output gains an n-dx line. Fix: start the update check only for built-in commands."
acceptanceCriteria:
  - "An extension command run starts no update check and prints no n-dx update notice"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
