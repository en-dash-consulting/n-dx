---
id: "598d6fd3-86d0-42d2-8a41-1030963777ef"
type: "change"
title: "Smart Add Command Regression Fix"
slug: "smart-add-command-regression-fix"
intent: "The `ndx add` orchestration command currently throws a 'missing .rex' error instead of delegating to `rex add` as expected. The fix should ensure `ndx add` spawns the rex CLI with the correct arguments and working directory, matching the behavior documented in CLAUDE.md."
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
source: "smart-add"
---
