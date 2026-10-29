---
id: "eb5711bb-8730-40bc-bbd4-606c31bb5ae2"
type: "task"
title: "ndx extensions refuses n-dx's global flags (--quiet, -q, --verbose, --debug) as unknown"
slug: "ndx-extensions-refuses-n-dx-s-global"
description: "Verdict: must-fix (regression from 9023c3d9c; trivial). runExtensions (packages/core/extensions-command.js:101-114) refuses any flag not in SUBCOMMAND_FLAGS[sub]; main() passes rest unchanged (cli.js:2585) and parses the global flags without removing them (cli.js:3770-3772). Trigger (reproduced): `ndx extensions list --quiet` exits 1 with \"does not take --quiet\"; same for -q, --verbose, --debug, which `ndx --help` documents. Fix (recommended): allow the global flags for every subcommand (or strip them in handleExtensions before runExtensions)."
acceptanceCriteria:
  - "ndx extensions <sub> accepts --quiet, -q, --verbose and --debug for every subcommand"
  - "A genuinely unknown flag is still refused"
  - "A test covers both"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
