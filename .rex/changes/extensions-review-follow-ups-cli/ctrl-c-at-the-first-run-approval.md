---
id: "13eb4c96-616f-4999-97c2-895b16d105d4"
type: "task"
title: "Ctrl+C at the first-run approval prompt exits 1 with an AbortError instead of 130"
slug: "ctrl-c-at-the-first-run-approval"
description: "Verdict: should-fix. terminalConfirm (extensions-command.js) rejects with AbortError on raw-mode Ctrl+C (confirmed on Node 24); nothing in handleExtensionCommand catches it, so main prints a formatted error and exits 1. Fix: catch AbortError there and exitWithCleanup(130) silently."
acceptanceCriteria:
  - "Ctrl+C at the approval prompt exits 130 with no error text and records no approval"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
