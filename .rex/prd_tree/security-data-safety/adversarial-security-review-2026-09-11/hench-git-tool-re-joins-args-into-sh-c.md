---
id: "0ce3ebb5-9971-414e-8b7c-eccb18133ff1"
level: "task"
title: "hench `git` tool re-joins args into `sh -c` with no shell-operator check"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:high"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`toolGit(guard, dir, {subcommand: \"status\", args: '\"--short; echo pwned > pwned.txt\"'})` does not create `pwned.txt`; the argument reaches git as a single literal token"
  - "`toolGit` no longer calls `execShell` with a joined string (or, if it does, `validateCommand` runs first and rejects operators)"
  - "Unit test in `packages/hench/tests/unit/` reproduces the injection string and asserts no side-effect file exists"
  - "`git commit -m \"message with spaces and ; semicolon\"` still works — the message reaches git intact"
description: "**Severity:** high · **Verdict:** must-fix\n\n**Failure scenario.** In API/local-model provider mode the model calls the `git` tool with `subcommand: \"status\"`, `args: \"\\\"--short; echo pwned > pwned.txt\\\"\"`. `toolGit` validates only the subcommand (`checkGitSubcommand`), then `splitArgs` strips the quotes and `args.join(\" \")` produces the string `git status --short; echo pwned > pwned.txt`, which `execShell` runs under `sh -c`. `validateCommand` — and therefore `SHELL_OPERATORS` — is never consulted on this path. Reproduced against `packages/hench/dist/tools/git.ts`: `pwned.txt` was created even though git itself failed (\"not a git repository\").\n\nThis makes the `git` tool a complete bypass of the command guard: any shell command runs, regardless of the `allowedCommands` allowlist, as long as it is prefixed by an allowed git subcommand.\n\n**Evidence.** `packages/hench/src/tools/git.ts:6-23` (join + execShell), `:26-52` (`splitArgs` strips quotes and does not re-quote), `packages/hench/src/guard/index.ts:107-115` (`checkGitSubcommand` — subcommand only).\n\n**Reachability.** Same as the command-guard finding: `provider: \"api\"`, local, or Google — opt-in but supported. Attacker = prompt injection from repo content.\n\n**Solution options.**\n1. *(Recommended)* Spawn argv directly: `exec(\"git\", [subcommand, ...splitArgs(args)], {cwd, timeout})` — no shell. `@n-dx/llm-client`'s `exec()` already takes argv. The quote-splitting then does exactly what it looks like it does. Cost: trivial. Risk: none — git never needed a shell here.\n2. Minimum: run `validateCommand(joined, [\"git\"])` before `execShell`. Still a shell string; fixes this hole only as well as the command-guard's operator set does."
lastModified: "2026-09-11T17:37:26.166Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
