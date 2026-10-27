---
id: "58f8f7b9-a152-4332-92ef-94b05ef69280"
type: "task"
title: "ndx commands that spawn rex several times print the v1 deprecation notice once per spawn"
slug: "ndx-commands-that-spawn-rex-several"
description: "Found by the adversarial review of ad842166 (run 4b2a3fc7). Verdict: should-fix, low.\n\nad842166 asked for one notice per command. rex prints it once per rex process (packages/rex/src/cli/legacy-layout-notice.ts), so an ndx command that spawns rex several times repeats it: `ndx ci` runs rex validate, health and status, which gives up to three identical lines. Failure-path details in packages/core/ci.js (rexStatus.stderr || stdout) and the web server's CLI error messages (routes-rex-analysis.ts, routes-commands.ts) also start with the notice line ahead of the real error.\n\nOptions:\n1. (Recommended) core cli.js checks the v1 tree itself (prd_tree/ present, no product/ under resolveLayout(dir).rexDir, as packages/core/migrate-chain.js does), prints the line once per ndx command, and sets NDX_LEGACY_NOTICE=off for every child it spawns. Cost: a small helper in cli.js plus a test; rex keeps printing for direct rex use.\n2. Set NDX_LEGACY_NOTICE=off only in ci.js and web's CLI spawns. Smaller, but leaves other multi-spawn commands."
acceptanceCriteria:
  - "ndx ci . on a v1 project prints the deprecation notice exactly once"
  - "ndx status . on a v1 project prints it exactly once"
  - "A root e2e test counts the notice in ndx ci's stderr"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "core"
source: "ndx-adversarial-review"
---
