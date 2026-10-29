---
id: "34624149-f10d-40ae-a334-fc1b4e533727"
type: "task"
title: "ndx extensions add file:///C:/... resolves to C:\\C:\\... on Windows"
slug: "ndx-extensions-add-file-c-resolves-to"
description: "Verdict: should-fix (trivial; regression from 9023c3d9c). localSpecPath (packages/core/extensions-command.js:710-717) resolves file:///C:/x/y against cwd as C:\\C:\\x\\y, so npm gets a nonexistent path; before the fix npm handled the URL itself. Fix: for ^file:// specs use fileURLToPath(spec)."
acceptanceCriteria:
  - "A file:// spec resolves to the right local path on Windows and POSIX, covered by a test"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
