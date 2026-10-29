---
id: "6fd9edf1-f003-480c-b0ee-4c498c1ddf7b"
type: "task"
title: "ndx --help lists an extension command that then fails as Unknown command when an invalid extension shares the name"
slug: "ndx-help-lists-an-extension-command"
description: "Verdict: should-fix. extension-dispatch.js:102 and :379-382 take the first claimant in precedence order; an invalid extension claims by its own name, but discovery's conflict pass (resolveWinners) counts only valid extensions. Trigger (run): user-source ndx-recon invalid with name recon, plus a dev ndx-other declaring command recon: help lists recon, `ndx recon` says Unknown command blaming ndx-recon, list/doctor show no conflict. Fix (recommended): count invalid extensions' names in the conflict pass so both are refused and help drops the command; alternatively prefer a claimant whose manifest lists the command."
acceptanceCriteria:
  - "A command listed by ndx --help always dispatches, or the clash is reported by list and doctor and the command is not listed"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
