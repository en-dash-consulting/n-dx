---
id: "c990fd76-cedc-405f-8e36-86a98fa015cc"
level: "task"
title: "Make ndx export --deploy=github work on Windows (rm -rf and POSIX shell syntax)"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "core"
  - "export"
  - "spawn"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The rm -rf loop is replaced with Node fs rm({recursive:true, force:true}) — no shell invocation for file deletion"
  - "No POSIX-only shell syntax (2>/dev/null, || true, /dev/null) remains in export.js"
  - "Path interpolations into shell strings are either hardened via win-spawn.js or eliminated in favor of argv-based invocation"
  - "`ndx export` completes on Windows from a project path containing a space and an & character"
  - "export.js is covered by the DEP0190 / shell-string guard"
  - "Verified against a scratch repo — no force-push to a real deploy branch during testing"
description: "`ndx export --deploy=github` invokes POSIX-only shell commands and fails on Windows:\n\n- packages/core/export.js:489 — `execSync(`rm -rf \"${join(tmpWorktree, f)}\"`)` inside a loop over every file in the worktree. `rm` is not a cmd.exe command and is not normally on PATH on Windows (Git for Windows ships usr/bin/rm.exe but does not add it to PATH). There is NO try/catch, so this throws and aborts the deploy.\n- packages/core/export.js:475 — `execSync(\"git rm -rf . 2>/dev/null || true\")`. `2>/dev/null` and `|| true` are POSIX sh constructs; `/dev/null` is not a Windows path and cmd.exe does not support `||` with the same semantics.\n\nFIXES: replace the `rm -rf` loop with Node's `rm(path, { recursive: true, force: true })` from node:fs/promises (or rmSync) — no shell involved, correct on all platforms, and `force: true` subsumes the `|| true` intent. For line 475, drop the shell redirection and call git through the hardened helper, tolerating a non-zero exit in JS rather than in shell syntax.\n\nWhile in this file, audit the remaining ~20 execSync call sites for the same two problems: (a) hand-quoted interpolation of paths that may contain spaces or cmd.exe metacharacters (e.g. line 195 `rex status --format=json \"${dir}\"`, line 466 `git worktree remove \"${tmpWorktree}\"`), and (b) any other POSIX-only construct. Note that execSync always goes through a shell, so bare `.cmd` shim resolution is NOT the problem here — quoting and POSIX-only commands are.\n\nAdd export.js to DEP0190_SCOPE (or to whatever replaces it per the sibling guard task) so this file is scanned going forward.\n\nVERIFICATION CAVEAT: this flow force-pushes to a deploy branch (export.js:509 `git push --force origin ${branch}`). Test against a scratch repo/branch, never a real deploy target."
---
