---
id: "0cc63aed-a641-4bbc-9a43-b2b18713c668"
type: "task"
title: "Discovery cache never sees manifest or version changes in symlinked packages, so a changed manifest runs without re-approval"
slug: "discovery-cache-never-sees-manifest-or"
description: "Verdict: must-fix. listedScan (packages/core/extension-discovery.js:258-266) watches only the listing, node_modules and scope dirs. For a file:/link:/workspace dependency or `ndx extensions add <folder>` (npm links folders), editing the target's package.json (version 1->2, bin a.js->b.js) leaves discovery returning 1.0.0 and bin/a.js (reproduced): the contract's 'a changed manifest or version asks again' does not fire and dispatch runs a stale bin until some unrelated node_modules change. tests/unit/extensions-command.test.js:92's fake npm bumps the listing mtime by hand and hides it. Fix (recommended): add each found package's package.json to the watch set (one stat per extension; update the stat-count test, the criterion is <50 ms). Alternative: watch only symlinked package dirs."
acceptanceCriteria:
  - "Editing a symlinked extension's package.json (version or ndx.extension) is reflected by the next discovery"
  - "A changed manifest hash or version through a symlinked package prompts for approval again"
  - "ndx --help with 20 installed extensions still adds under 50 ms"
priority: "high"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
