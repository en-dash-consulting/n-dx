---
id: "936b9f63-2a7e-454d-89f3-2c3d9f055021"
level: "task"
title: "ndx init does not gitignore claude_commands.log, so hench's commit gate refuses completion over n-dx's own CLI log in a fresh project"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "hench"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ndx init` on a fresh repository writes a `claude_commands.log*` entry to .gitignore (unit test on the init gitignore entries)"
  - "hench's uncommitted-work gate does not count claude_commands.log as uncommitted work; a task whose only dirt is that file completes (unit test next to the existing runtime-artifact-only test)"
  - "A fresh project initialised by ndx init, with the dashboard credential probe run once, completes an agent task without a commit-gate refusal"
description: "Severity: high. Verdict: out-of-scope for the Playwright change that exposed it (pre-existing), worth fixing: it blocks every agent run in a newly initialised project.\n\nFAILURE SCENARIO\nA project is initialised with `ndx init`. Any vendor-CLI invocation appends to `claude_commands.log` in the project root (packages/llm-client/src/cli-log.ts CLI_LOG_FILENAME, twin packages/core/cli-log.js) — the dashboard's credential probe (`GET /api/commands/auth` → `ndx auth`), `ndx work`, `claude --version` catalog probes all write it. The file is untracked because init writes `.gitignore` entries only for `.n-dx.local.json`, `ndx-export/` and the graview dir (packages/core/cli.js:1596 ensureGitignoreEntry). The agent finishes a task, commits its work, the test gate passes, and then hench's uncommitted-work gate refuses: \"Refusing to mark this task completed: 1 path(s) of its work are still uncommitted. claude_commands.log\". Observed verbatim in a manual Playwright run on 2026-10-13 (run c4bdb0ad…, hench status failed, summary says the work was done and committed).\n\nThe n-dx repository itself hides the defect: its own .gitignore:73 has `claude_commands.log*`. Every other project hits it.\n\nEVIDENCE\n- packages/core/cli.js:1596 — the init gitignore entries (no claude_commands.log)\n- packages/llm-client/src/cli-log.ts:31 — the log is written into the project directory\n- packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts — the gate names it as uncommitted work\n- .gitignore:73 in this repo — the entry the product never writes for users\n\nREACHABILITY: every user of a project initialised by ndx init whose dashboard or CLI has run a vendor CLI once.\n\nSOLUTIONS\n1 (recommended, both halves): in init, `ensureGitignoreEntry(dir, \"claude_commands.log*\")` next to the existing entries, and have the uncommitted-work gate discount n-dx's own runtime files (the CLI log, alongside the hench artifacts it already discounts via excludeHenchRuntimeArtifacts in packages/hench/src/store/artifacts.ts). Cost: two small changes plus unit tests. Risk: none beyond the gate exemption list growing.\n2: only the gate exemption. Cheaper, but leaves the untracked file showing in every user's git status."
lastModified: "2026-10-13T19:08:46.283Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
