---
id: "d9008bb7-0b2b-4080-99a0-688e7cdc509f"
type: "task"
title: "A claudePath an older ndx init wrote into .hench/config.json turns the user's own checkout untrusted after upgrade, and re-running init does not move it"
slug: "a-claudepath-an-older-ndx-init-wrote"
description: "**Severity:** low · **Verdict:** should-fix (found by the adversarial review of e1684072).\n\n**Failure scenario.** Before e1684072, `ndx init` persisted a Claude binary it discovered outside PATH (e.g. `~/.claude/local/claude`) as `claudePath` in `.hench/config.json`. After e1684072 a non-bare `claudePath` there is a `vendor-cli-path` trust finding (packages/llm-client/src/repo-trust.ts, `henchClaudePath` in `collectRepoExecutionConfig`). So that checkout moves from `baseline` to `untrusted` on upgrade: `ndx work` prints the trust warning, clamps the user's own guard to the language baseline and lowers bypassPermissions, until the user runs `ndx trust accept .`. Re-running `ndx init` does not help: `persistDiscoveredClaudePath` (packages/core/claude-integration.js) now writes `.n-dx.local.json` but leaves the stale `.hench/config.json` value in place.\n\n**Reachability.** Users whose earlier `ndx init` ran without `claude` on PATH but where a well-known install existed. Narrow: hench's `requireLLMCLI` preflight checks the bare `claude` / `cli_path` anyway, so the run behaviour is unchanged apart from the trust state.\n\n**Options.** 1 (recommended): when `persistDiscoveredClaudePath` writes the local value, also remove a `claudePath` from `.hench/config.json` equal to a well-known discovery candidate (or to the value it writes). Small; risk: deleting a value the user set by hand, mitigated by matching only discovery candidates. 2: document the `ndx trust accept .` / move-to-local step in the changeset only. Cheapest; leaves the warning."
acceptanceCriteria:
  - "Re-running ndx init in a checkout whose .hench/config.json holds a discovery-written absolute claudePath moves it to .n-dx.local.json hench.claudePath and removes it from .hench/config.json"
  - "After that re-run the checkout evaluates as baseline, not untrusted (test)"
  - "A hand-set claudePath that is not a discovery candidate is left in .hench/config.json"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
source: "ndx-adversarial-review"
---
