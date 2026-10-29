---
id: "208cd8c3-6262-4cfd-8602-be4fa1e5bb45"
type: "task"
title: "The agent cannot write n-dx's own config files, so it cannot hand itself a user config that always applies"
slug: "the-agent-cannot-write-n-dx-s-own"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding C (high, must-fix; found by two of the three passes and probed against the guard).\n\nFailure scenario: the guard baseline's CORE_BLOCKED (packages/llm-client/src/repo-trust.ts:155-160) does not cover .n-dx.local.json, .n-dx.json, .mcp.json or .claude/**. PRD content, a README or a code comment in an untrusted checkout steers the agent into writing .n-dx.local.json with hench.guard.env.allow [\"*\"], llm.claude.cli_path, an api_endpoint or llm.google.apiKeyEnv. The file is untracked, so it reads as the user's own and applies with no trust review; it is gitignored, so git status and the diff gates see nothing. repoCommandEnv re-reads it on every call, so the same task's completion test gate already gets every credential; cli_path and the endpoint take effect on the next task of a --loop.\n\nProbed: validatePath against the baseline guard allows .n-dx.local.json, .n-dx.json and .mcp.json (.env blocked as the control); after the write, the env names a repo command receives grow from PATH alone to every fake credential the probe set, and loadLLMConfig returns the agent-written cli_path and endpoint. State stayed baseline throughout.\n\nReachable: any `ndx work` run in an untrusted checkout whose content can steer the agent. Pre-existing guard gap; this stack makes the untracked local file the trust escape hatch, which raises its impact.\n\nOptions: (a) add .n-dx.local.json, .n-dx.json, .mcp.json, .claude/** and .codex/** (and the .ndx/ layout equivalents, via resolveLayout rather than literals) to CORE_BLOCKED, and give the Claude CLI under provider=cli matching deny rules for Edit/Write so the vendor CLI cannot write them either. Cost: small; risk: a task that legitimately edits n-dx config now needs the operator. (b) Snapshot the local config's hash at run start and ignore or refuse a mid-run change. Recommended: (a); (b) only if (a) cannot reach the CLI provider."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): neither hench's tools nor the vendor CLI it drives can create or edit n-dx's own config files in a checkout"
  - "The baseline guard blocks .n-dx.local.json, .n-dx.json, .mcp.json, .claude/** and .codex/** on both layouts (paths from resolveLayout, no new literals)"
  - "Under provider=cli the spawned vendor CLI is denied writes to the same paths"
  - "Test: the guard refuses a write to each of those paths, and a run whose agent attempts one leaves repoCommandEnv's output unchanged; the test fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
