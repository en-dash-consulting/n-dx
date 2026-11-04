---
id: "f5efde56-48b6-4a78-a891-fcda1d312e46"
type: "task"
title: "An interpreter helper whose script path has a space gets a Claude CLI deny rule the quoted command never matches"
slug: "an-interpreter-helper-whose-script"
description: "Found by the adversarial review of 9dd5658d (run be1f1547). Verdict: should-fix, low.\n\nFailure scenario: helper stored as [\"node\", \"/Users/Ryan Keith/bin/get-key.mjs\"] (or a Windows home such as C:\\Users\\First Last\\..., or ~/Library/Application Support/...). agentCredentialDenials now yields the prefix [\"node\", \"<script>\"], and buildDisallowedTools (packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts, `Bash(${prefix.join(\" \")}:*)`) emits `Bash(node /Users/Ryan Keith/bin/get-key.mjs:*)`. A Claude CLI agent has to quote the path to run it at all — `node \"/Users/Ryan Keith/bin/get-key.mjs\"` — and Claude's prefix match is on the literal command, so the rule never matches and the helper runs. Before 9dd5658d the bare `Bash(node:*)` blocked it. hench's own guard is unaffected: commandWords unquotes before comparing (packages/hench/src/guard/commands.ts). The same gap already existed, pre-change, for an argv[0] with a space (e.g. \"/Applications/My Tools/op\").\n\nReachability: any Claude CLI ndx work run with such a helper stored. Mitigation in practice: an allowed interpreter (`node -e`) can read the store anyway (documented gap until C10), so the deny list is a speed bump, hence low.\n\nOptions: (1) recommended — in buildDisallowedTools, when any token of a prefix holds whitespace, also emit the double-quoted and single-quoted spellings of those tokens (`Bash(node \"/Users/Ryan Keith/bin/get-key.mjs\":*)`, `Bash(node '/Users/…':*)`). Cheap; backslash-escaped spaces remain unmatched. (2) Deny the bare interpreter again when the script path has whitespace — closes more but brings back the original bug for those users. (3) Refuse such helpers at --helper time — hostile to Windows users with spaces in their home."
acceptanceCriteria:
  - "With a helper [\"node\", \"/x/my dir/get-key.mjs\"] stored, buildDisallowedTools includes Bash(node \"/x/my dir/get-key.mjs\":*) and Bash(node '/x/my dir/get-key.mjs':*) beside the unquoted rule, on POSIX and win32 argv"
  - "The same quoted spellings are produced for a non-interpreter helper whose argv[0] holds a space"
  - "Test: the argv test fails on the code before the fix"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
source: "ndx-adversarial-review"
---
