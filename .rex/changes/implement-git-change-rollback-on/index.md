---
id: "a6199e02-a954-44dd-b49f-c6519fa673e4"
type: "change"
title: "Implement git change rollback on failed hench runs"
slug: "implement-git-change-rollback-on"
intent: "When a hench work run ends in failure, detect the failure condition and revert uncommitted file changes introduced during the run. Capture a pre-run git state marker (stash ref or HEAD SHA) before hench begins modifying files, then perform a targeted rollback on failure. A --no-rollback flag allows the user to inspect partial changes instead of reverting."
acceptanceCriteria:
  - "A pre-run git state marker is captured before hench modifies any files"
  - "On run failure, all uncommitted changes introduced during the run are reverted to the pre-run state"
  - "A --no-rollback flag suppresses automatic rollback and leaves changes in place"
  - "Rollback result (number of files reverted) is printed to the console after a failed run"
  - "If no changes were made during the run, the rollback step is skipped silently"
amends: [{"target":"3415b5f0-3496-4813-8cc9-9f571044d49c","delta":"modified","summary":"Implement git change rollback on failed hench runs","base":"fd07c624f09bae801165b121b0a72e7961205c44fbd8356e943873cefe09045f"}]
priority: "high"
tags:
  - "hench"
  - "git"
  - "recovery"
source: "smart-add"
---
