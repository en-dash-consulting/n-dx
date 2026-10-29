---
id: "69051203-482f-47c2-985a-51565fcc89fe"
type: "task"
title: "Ctrl+C at the ndx extensions enable prompt exits 1 with error text, and the first-run 130 path is untested"
slug: "ctrl-c-at-the-ndx-extensions-enable"
description: "Verdict: should-fix. enable uses the same terminalConfirm; its AbortError is caught in handleExtensions (packages/core/cli.js:2584-2590), formatted and exit 1. The first-run catch (cli.js:3537-3546) has no test: the unit test only checks approveOnFirstRun rethrows, so reverting the cli.js catch passes. Fix: catch AbortError in handleExtensions and exit 130 silently; add a pty-free test by injecting confirm into an exported helper for both paths."
acceptanceCriteria:
  - "Ctrl+C at the enable prompt exits 130 with no error text and records no approval"
  - "Tests fail if either the first-run or the enable 130 handling is reverted"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
