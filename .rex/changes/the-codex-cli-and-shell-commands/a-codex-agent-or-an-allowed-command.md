---
id: "bfb205e4-24e7-4d4e-b77a-ed3190d428e9"
type: "task"
title: "A Codex agent or an allowed command cannot leave n-dx's own config files changed"
slug: "a-codex-agent-or-an-allowed-command"
description: "The rest of the whole-stack re-review's finding C (high), split out of 208cd8c3 by its run (770d5503). 208cd8c3 added NDX_CONFIG_BLOCKED_PATHS to every guard baseline, so hench's file tools refuse n-dx's own config files, and it spawns the Claude CLI with --disallowed-tools Edit(...) rules for the same paths. Its first criterion (\"neither hench's tools nor the vendor CLI it drives can create or edit n-dx's own config files\") is not met yet on two routes.\n\nFailure scenario 1, Codex: with provider=cli and vendor codex, `codex exec` has no per-path deny. workspace-write makes the whole checkout writable, so a Codex agent steered by repository content writes .n-dx.local.json with hench.guard.env.allow [\"*\"], a cli_path or an endpoint. The file is untracked and gitignored, so it reads as the user's own and applies with no trust review. The completion test gate's repoCommandEnv reads it in the same task.\n\nFailure scenario 2, allowed commands: under either vendor, an allowed command writes any file. Examples are `node -e \"require('fs').writeFileSync('.n-dx.local.json', ...)\"` through Bash(node:*) under Claude, or run_command node under the API loop. That bypasses both the guard's path check and Claude's Edit rules.\n\nAlso from the 208cd8c3 review (medium, not verified against a live claude binary): Claude Code may match Edit(./.n-dx.local.json) case-sensitively, so `.N-DX.local.json` could get through on macOS and Windows. A content backstop catches every spelling.\n\nOptions: (a, recommended) a vendor-neutral backstop. Snapshot the content of each protected config file (both layouts, paths from resolveLayout; .mcp.json; .claude/** and .codex/** settings files) before each agent spawn and tool loop. Compare after the agent finishes, before the completion test gate or any repository command reads them. On a change, restore the snapshot (delete a file the agent created), fail the task with a finding that names the path but not the content, and record it in the run. Cost: one module in hench, wired at the spawn and loop seams; the snapshot is a handful of small files. (b) Per-vendor denies: Codex has no path deny, and shell writes cannot be denied by path, so (b) cannot close either route on its own."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): a run cannot leave n-dx's own config files changed, whichever vendor, provider or tool wrote them"
  - "A Codex CLI run whose agent writes .n-dx.local.json leaves the config the completion test gate and the next command read unchanged, and the run reports it"
  - "A shell command (node, npm) that writes a protected config file, under either vendor and under the API tool loop, has the same outcome"
  - "A write under another spelling (.N-DX.local.json on a case-insensitive filesystem) has the same outcome"
  - "The run's finding names the path and never the file's content"
  - "Test: each route above is restored and reported; the tests fail on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
