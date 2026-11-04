---
id: "9da6d298-51b4-4e0d-88df-8efee59a8d06"
type: "task"
title: "C7: Claude CLI deny rules and hench's guard keep agents out of the credential store"
slug: "c7-claude-cli-deny-rules-and-hench-s"
description: "PR 1. The store sits outside the project root, so the cwd-anchored Edit(./...) rules from NDX_CONFIG_BLOCKED_PATHS do not reach it, and the Claude CLI is granted bare Read/Glob/Grep. Add absolute Read(//<path>) and Edit(//<path>) deny rules built from resolveNdxHome() at spawn time (Windows: Claude Code's //c/... form; argv joined by commas on win32). hench's validatePath already refuses paths escaping the root; assert it, and add a runtime blocked pattern for an ndx home inside the root. The Codex CLI sandbox can read the store and has no path deny: document the gap. Command denylist waits for C4. Conflicts with Sidecar M1 (#901) on buildDisallowedTools; whichever merges second rebases."
acceptanceCriteria:
  - "CLI-provider runs pass Read(//<store path>) and Edit(//<store path>) in --disallowed-tools, path from resolveNdxHome() at spawn; argv tests cover POSIX and the win32 //c/... form with the comma-joined list"
  - "hench's guard refuses the store path when the ndx home is outside the project (asserted) and when it is inside (runtime blocked pattern, tested)"
  - "No stored value reaches any child env (test)"
  - "A code comment beside the deny rules and the PR body state that the Codex CLI sandbox can still read the store"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
