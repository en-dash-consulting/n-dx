---
id: "492bd249-6757-4263-adb3-3c119d545a31"
type: "task"
title: "Convert stray v1 files and warn on unreachable apply commits"
slug: "convert-stray-v1-files-and-warn-on"
description: "ndx migrate converts v1 PRD files that arrive from branches opened before the cut. rex health warns when an applied change's appliedIn commit is not reachable from main (the sign of a squash or rebase merge). Before warning, try the re-point from PR 11; warn only for SHAs it cannot match."
acceptanceCriteria:
  - "A stray v1 item converts with the plan's rules (test)"
  - "The health warning fires on a squashed fixture"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
source: "roadmap"
blockedBy:
  - "11c88bce-4e63-4e56-b0b8-041232f0a21a"
---
