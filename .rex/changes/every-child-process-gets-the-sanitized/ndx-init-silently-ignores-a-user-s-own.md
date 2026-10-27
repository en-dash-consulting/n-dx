---
id: "d59b5373-56ca-4851-a8bf-7730188f52d2"
type: "task"
title: "ndx init silently ignores a user's own shared cli.claudePath after upgrade, with no hint to move it to .n-dx.local.json"
slug: "ndx-init-silently-ignores-a-user-s-own"
description: "**Severity:** low · **Verdict:** should-fix (found by the adversarial review of fd5f6116).\n\n**Failure scenario.** Before fd5f6116, `ndx config cli.claudePath /opt/claude` wrote the shared `.n-dx.json`. After it, `discoverClaudeCli` (packages/core/claude-integration.js, `readConfiguredClaudePath`) reads only `.n-dx.local.json`, so that value is skipped without a word: init falls back to PATH and well-known locations, and when none has claude the not-found `searched` list never mentions the ignored setting. The same value is also a `vendor-cli-path` trust finding, so the user's own checkout reads as untrusted. Only the changeset says to move it.\n\n**Reachability.** `ndx init` in a checkout whose `.n-dx.json` holds `cli.claudePath` set by an older `ndx config` (or by hand) and no local one. Narrow: the setting exists for non-standard installs.\n\n**Options.** 1 (recommended): when the shared file sets `cli.claudePath` and the local one does not, add a `searched` entry / init note naming the field (not its value) and the move to `.n-dx.local.json`. Small; read the shared file only for presence, never run it. 2: changeset only (today). Cheapest; leaves a silent fallback.\n\nRelated: d9008bb7 (same upgrade class for hench claudePath in .hench/config.json)."
acceptanceCriteria:
  - "ndx init in a checkout whose shared .n-dx.json sets cli.claudePath (and .n-dx.local.json does not) prints a note naming cli.claudePath and .n-dx.local.json, without the path value (e2e test)"
  - "The shared cli.claudePath is still never executed (existing sentinel e2e stays green)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
