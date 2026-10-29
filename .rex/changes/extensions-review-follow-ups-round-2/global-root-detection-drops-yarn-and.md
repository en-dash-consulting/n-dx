---
id: "d882ed86-4d9e-475e-a3f4-5546e59535d1"
type: "task"
title: "Global-root detection drops yarn and bun global installs, and pnpm when PNPM_HOME is unset"
slug: "global-root-detection-drops-yarn-and"
description: "Verdict: should-fix (silent regression from 9c200faba). findGlobalRoot (packages/core/extension-discovery.js:108-122) rejects a root whose parent has a package.json unless it is pnpm's PNPM_HOME layout; yarn classic's global dir and ~/.bun/install/global have one, and a hub launched from a GUI, cron or systemd often lacks PNPM_HOME, so extensions installed globally beside n-dx vanish. Fix (recommended): recognise the known global layouts (yarn global dir, bun global dir, pnpm root -g cached) or compare with the prefix derived from process.execPath / npm_config_prefix; have doctor say when no global source was recognised."
acceptanceCriteria:
  - "n-dx installed globally with yarn classic, bun or pnpm (PNPM_HOME unset) still discovers global extensions"
  - "A project-local install is still not treated as global"
  - "doctor reports when no global source was recognised"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
