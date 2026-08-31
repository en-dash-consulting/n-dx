---
id: "c86273ce-88fd-465c-8a90-7de4fde389ad"
level: "task"
title: "codex exec rejects the --full-auto flag, breaking autonomous codex spawns"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "compileCodexPolicyFlags (packages/llm-client/src/codex-cli-provider.ts:128) returns the --full-auto flag when policy.approvals is never and policy.sandbox is workspace-write, which is the autonomous default. codex-cli 0.147.0 removed that flag from codex exec, so the spawn dies on argument parsing before any model call. Observed live: ndx analyze --deep logged '[primer] skipped - error: unexpected argument --full-auto found' and printed the codex exec usage block. Reproduce: codex exec --full-auto --json --skip-git-repo-check x. The replacements on the exec surface are -s/--sandbox (read-only|workspace-write|danger-full-access), --approve-for-me, and -c approval_policy=. Note codex exec resume accepts neither -s nor --approve-for-me, so the resume branch added for the batch session strategy passes no policy flags; only the fresh-exec path is affected. Fix needs a live-verified flag mapping plus a regression test pinning the emitted flags against what the installed codex accepts, since this is the second time the codex arg surface has drifted underneath us."
lastModified: "2026-08-31T19:56:24.454Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
