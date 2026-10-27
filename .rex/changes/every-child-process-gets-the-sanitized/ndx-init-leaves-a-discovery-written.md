---
id: "5e036bd1-1cf3-4e5f-8a65-9ba191f429ce"
type: "task"
title: "ndx init leaves a discovery-written .hench/config.json claudePath in place when CLAUDE_CLI_PATH or a local cli.claudePath is set, or Claude integration is skipped"
slug: "ndx-init-leaves-a-discovery-written"
description: "**Severity:** low · **Verdict:** should-fix (found by the adversarial review of d9008bb7).\n\n**Failure scenario.** d9008bb7 moves a discovery-candidate `claudePath` from `.hench/config.json` to `.n-dx.local.json` inside `persistDiscoveredClaudePath` (packages/core/claude-integration.js), which `discoverClaudeCli` calls only from step 3 (PATH) and step 4 (well-known locations). Steps 1 (`CLAUDE_CLI_PATH`) and 2 (local `cli.claudePath`) return first, and `ndx init --no-claude` (or a Codex-only setup) never calls discovery. In any of those, a checkout whose `.hench/config.json` holds `~/.claude/local/claude` from an older init keeps it, stays `untrusted` (`vendor-cli-path`), and `ndx work` keeps clamping the guard until `ndx trust accept .`.\n\n**Reachability.** `ndx init` with `CLAUDE_CLI_PATH` exported, with `ndx config cli.claudePath` set locally, or with Claude integration off, in a checkout an older init wrote the path into. Narrow.\n\n**Options.** 1 (recommended): split the move into its own function and call it from `discoverClaudeCli` before step 1 (or from init directly, independent of the Claude assistant), keeping the \"never override a local claudePath\" rule. Small; same candidate matching. 2: leave it; `ndx trust accept .` or a manual move fixes it. Cheapest; leaves the warning for these users.\n\nKept in layer 2 by the session on 2026-10-27 (Ryan handed it the remaining runs and follow-up calls), option 1, to run after d59b5373: same upgrade class and same function as d9008bb7."
acceptanceCriteria:
  - "Closes #635 (follow-up): ndx init moves a claudePath an older init wrote into .hench/config.json whichever way it finds Claude, and with Claude integration off"
  - "With CLAUDE_CLI_PATH set to a working binary, ndx init moves a discovery-candidate claudePath from .hench/config.json to .n-dx.local.json hench.claudePath (test)"
  - "With cli.claudePath set in .n-dx.local.json, the same move happens (test)"
  - "A hand-set non-candidate claudePath still stays in .hench/config.json"
  - "Test fails on the code before the fix"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
