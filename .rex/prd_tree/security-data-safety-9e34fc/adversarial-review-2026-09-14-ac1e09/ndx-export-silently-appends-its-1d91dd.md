---
id: "1d91dd5b-c0fa-4492-8876-16c29bda0c84"
level: "task"
title: "`ndx export` silently appends its out-dir to `.gitignore`, even when that directory is git-tracked"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
startedAt: "2026-09-17T03:18:42.429Z"
completedAt: "2026-09-17T03:23:19.870Z"
endedAt: "2026-09-17T03:23:19.870Z"
resolutionType: "code-change"
resolutionDetail: "ndx export skips the .gitignore write for a git-tracked out-dir with a notice naming it, announces the entry when it does add one, and isGitTracked moved to gitignore.js beside the writer it governs."
acceptanceCriteria:
  - "`ndx export --out-dir=docs/site` in a repo where `docs/site/` has tracked files does not add `docs/site/` to `.gitignore`, and prints a notice saying why"
  - "When export does add an entry to `.gitignore`, it prints one line naming the entry (e.g. `[export] added ndx-export/ to .gitignore`)"
  - "The existing `tests/e2e/cli-export.test.js` gitignore case still passes, and a new case covers the tracked-directory skip"
description: "**Severity:** low · **Verdict:** should-fix · **Introduced by commit 796be400 (this branch)**\n\n**Failure scenario.** `runExport` (`packages/core/export.js:303-310`) computes the out-dir relative to the project and, when it is inside the project, calls `ensureGitignoreEntry` before the deploy gate and with no console output. A user who exports into a directory they already track — `ndx export --out-dir=docs/site` feeding their own Pages pipeline — gets `docs/site/` appended to `.gitignore`. Tracked files stay tracked, but every *new* file written there afterwards is invisible to `git status`, and nothing told them the file was edited. `ensureGitignoreEntry` returns a boolean specifically so callers can report the write, and `ndx init` is the only caller that behaves as a setup command where a silent write is expected.\n\n**Refutation attempted.** Looked for a tracked-path check around the call — none. Looked for a log line — none (the `[export]` log lines start after the gate). Confirmed `--out-dir=.` and `..` are skipped by the `outRel` guard, so the worst case is a subdirectory, not the repo root.\n\n**Evidence.** `packages/core/export.js:303-310`, `packages/core/gitignore.js:24-37`, `packages/core/ci.js` (`isGitTracked`, a reusable helper).\n\n**Reachability.** Any user who passes `--out-dir` pointing at a directory they commit. Niche but real; the default `ndx-export/` case is fine.\n\n**Solution options.**\n1. *(Recommended)* Before writing, run `git ls-files --error-unmatch -- <outRel>` (reuse `isGitTracked` from `ci.js`, moved to `gitignore.js` or a small git helper); if tracked, skip and print `[export] <dir> is git-tracked — not adding it to .gitignore`. When the entry is added, print one line saying so. Cost: small.\n2. Only gitignore the *default* out-dir (`ndx-export/`) and never a user-supplied one. Simpler, but leaves a user-chosen in-repo dir committable, which the original finding cared about."
lastModified: "2026-09-17T03:23:20.253Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
