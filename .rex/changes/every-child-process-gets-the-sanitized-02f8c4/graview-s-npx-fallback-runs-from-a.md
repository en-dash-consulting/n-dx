---
id: "0a3bfa7b-3b67-4500-b0a1-0602445f46fc"
type: "task"
title: "graview's npx fallback runs from a neutral directory, so a graview the repository plants never runs"
slug: "graview-s-npx-fallback-runs-from-a"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding F (high, must-fix; pre-existing, same class as the graview.bin gate (083c929b)).\n\nFailure scenario: with no graview on PATH and no product face found (a typical npm install), graview-bin.ts:161 falls back to `npx -y graview@<version>` and runGraview (packages/graview/src/cli/index.ts) spawns it with cwd = layout.root. A repository that ships package.json, node_modules/graview at that version and node_modules/.bin/graview gets its copy run: npx resolves the local install first.\n\nProbed: `planted graview ran check x`, trust state baseline. A repository .npmrc registry= setting should steer the same path (not tested).\n\nReachable: `ndx graview check|describe|serve|mcp`.\n\nOption: run the npx fallback with cwd set to a directory n-dx owns (under NDX_HOME); every graview argument is already absolute. Also pass npx an explicit --userconfig or registry so a repository .npmrc cannot steer it, if cheap."
acceptanceCriteria:
  - "Closes #686 (follow-up): no graview binary the repository ships is run, through the configured path or the npx fallback"
  - "The npx fallback runs with a cwd outside the project, and graview's arguments stay absolute"
  - "Test: a fixture repository with a planted node_modules/graview at the pinned version does not run when the fallback is taken (marker file absent); the test fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
