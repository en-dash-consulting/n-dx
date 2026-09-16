---
id: "ac1e0940-cb5b-416d-8ca6-a9711f3bcd13"
level: "feature"
title: "Adversarial review 2026-09-14 — findings against the September security fix branch"
status: "pending"
priority: "high"
tags:
  - "security"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
acceptanceCriteria: []
description: "Findings from an adversarial review (2026-09-14, `/ndx-adversarial-review`, diff mode) of branch `chore/adversarial-vulnerability-review-September-2026` against `origin/main` — the 12 commits that fixed the 2026-09-11 security findings. Scope: the 9 fixes across core, hench, llm-client, rex, web (source + tests).\n\nGround truth at review time: `pnpm typecheck` green; hench 64, rex 13, llm-client 64, web 173, root e2e 337 tests green. Those runs did not exercise quoted command substitution in the hench guard, the cmd.exe shell path, or the contents of the exported `runs.json` index — the three gaps behind the must-fix findings.\n\nAttacked and found sound (no item filed): git tool argv spawn (no shell on any platform, quoted tokens stay single args); Gemini key moves to `x-goog-api-key` in provider and preflight; body cap ordering (Content-Length guard runs before MCP and every route; chunked bodies bounded by `readBody`); WebSocket origin gate reuses the HTTP origin check and viewer clients use `location.host`; `ndx dev` serves the viewer from the same port; adaptive/workflow allowlists reject unknown keys and prototype segments before any write; `routes-config` live-model write-back reads the shared file, and no other dashboard route copies merged (local) config into the shared file; `ndx config *.api_key` routes to `.n-dx.local.json` and migrates a shared copy out; lock empty-file race fix (documented trade-off: an empty lock left by a crash is never auto-reclaimed, fails loudly).\n\nNot-worth-fixing, recorded here: adaptive routes may still write `guard.allowedCommands` / `guard.blockedPaths` / `rexDir` (same-origin only, identical to the config editor PUT by design); WebSocket gate refuses a port-forwarded https origin (HTTP mutations were already refused there — consistent contract).\n\nOut-of-scope, pre-existing, not filed here: hench git tool passes free-form args to git and the default subcommand allowlist (`log`, `diff`, `show`) accepts `--output=<path>`, so `git log --output=~/.zshrc -1` writes outside the project, bypassing `blockedPaths` (which guards only the file tools). Medium. Belongs under the hench guard area.\n\nEach child task carries the failure scenario, `file:line` evidence, reachability, and solution options with a recommendation. Tasks are independent."
lastModified: "2026-09-14T18:59:53.104Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Dashboard config validator accepts values hench's schema rejects, leaving `.hench/config.json` unloadable](./dashboard-config-validator-accepts.md) | completed |
| [hench command guard passes `$(…)` and backticks inside double quotes, which `sh` expands](./hench-command-guard-passes-and.md) | completed |
| [hench command guard's POSIX quote model lets `&`, `|`, `<`, `>` through on the cmd.exe fallback](./hench-command-guard-s-posix-quote.md) | completed |
| [`ndx ci` config-secrets step never fails on a git-tracked `.n-dx.local.json`](./ndx-ci-config-secrets-step-never-fails.md) | pending |
| [`ndx export` sanitizer leaves test output, command lines, and audit errors in published run records](./ndx-export-sanitizer-leaves-test.md) | completed |
| [`ndx export` silently appends its out-dir to `.gitignore`, even when that directory is git-tracked](./ndx-export-silently-appends-its-out.md) | pending |
| [`ndx export` strips `error` from per-run files but still publishes it in the `runs.json` index](./ndx-export-strips-error-from-per-run.md) | completed |
| [`readBody` destroys an over-cap chunked request before any response, so the client sees EPIPE instead of the documented 400](./readbody-destroys-an-over-cap-chunked.md) | pending |
