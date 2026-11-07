---
id: "c86273ce-88fd-465c-8a90-7de4fde389ad"
type: "capability"
title: "codex exec rejects the --full-auto flag, breaking autonomous codex spawns"
slug: "codex-exec-rejects-the-full-auto-flag"
statement: "When an autonomous codex run starts a fresh codex exec, the codex CLI provider passes only approval and sandbox policy flags that the installed codex exec accepts, so the run gets past argument parsing to the model call; a resumed codex exec re-applies the same policy with -c sandbox_mode= and -c approval_policy= overrides, since codex exec resume rejects --sandbox."
criteria: [{"id":"c1","text":"When the policy sets approvals to never and sandbox to workspace-write, the codex CLI provider shall not emit the --full-auto flag on a fresh codex exec spawn."},{"id":"c2","text":"When the codex CLI provider builds a fresh codex exec spawn, it shall express the sandbox policy with -s/--sandbox (read-only, workspace-write or danger-full-access)."},{"id":"c3","text":"When the codex CLI provider builds a fresh codex exec spawn, it shall express the approval policy with a flag that the installed codex exec accepts (--approve-for-me or -c approval_policy=)."},{"id":"c4","text":"When the codex CLI provider spawns codex exec resume, it shall re-apply the sandbox and approval policy with -c sandbox_mode= and -c approval_policy= overrides and pass no --sandbox flag."},{"id":"c5","text":"When an autonomous codex spawn runs under ndx analyze --deep, the codex CLI provider shall start codex exec without an argument-parsing error, so the primer step is not skipped."}]
priority: "high"
---

compileCodexPolicyFlags (packages/llm-client/src/codex-cli-provider.ts:128) returns the --full-auto flag when policy.approvals is never and policy.sandbox is workspace-write, which is the autonomous default. codex-cli 0.147.0 removed that flag from codex exec, so the spawn dies on argument parsing before any model call. Observed live: ndx analyze --deep logged '[primer] skipped - error: unexpected argument --full-auto found' and printed the codex exec usage block. Reproduce: codex exec --full-auto --json --skip-git-repo-check x. The replacements on the exec surface are -s/--sandbox (read-only|workspace-write|danger-full-access), --approve-for-me, and -c approval_policy=. Note codex exec resume accepts neither -s nor --approve-for-me, so the resume branch added for the batch session strategy passes no policy flags; only the fresh-exec path is affected. Fix needs a live-verified flag mapping plus a regression test pinning the emitted flags against what the installed codex accepts, since this is the second time the codex arg surface has drifted underneath us.

## History

- 2026-11-07 84d07c33-0fb2-4a54-9e9b-88acd0abd9cb modified: A resumed codex exec re-applies the policy with -c overrides
