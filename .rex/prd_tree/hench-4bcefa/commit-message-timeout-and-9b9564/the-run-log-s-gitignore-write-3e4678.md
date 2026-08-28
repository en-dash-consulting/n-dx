---
id: "3e46780d-719a-486c-a9d5-11f4f18a9166"
level: "task"
title: "The run log's .gitignore write lands after the commit step and leaves the tree dirty"
status: "pending"
priority: "medium"
tags:
  - "hench"
  - "git-residue"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "A first hench run in a fresh project leaves no uncommitted .gitignore change behind"
  - "The `.run-logs/` ignore entry is present after that run, however it gets there"
  - "A project initialised before this change still gets the entry without leaving the tree dirty"
  - "A test asserts the working tree is clean after a run in a project whose .gitignore lacked the entry beforehand"
description: "Found while fixing task 544d93d2 (PRD completion metadata left uncommitted). Same residue class — a run writes a tracked file after the commit step has already run — but a different writer, so that fix does not cover it.\n\n`writeRunLog` calls `ensureGitignored` (packages/hench/src/store/run-log.ts:41, :64-86), which appends `.run-logs/` to the project `.gitignore`, creating the file if absent. That runs during finalize, after `performCommitPromptIfNeeded`: in the live `--review` run ea962353 the \"Run log:\" line printed after \"Attribution: recorded commit\", and in a fixture for the 544d93d2 tests the resulting `M .gitignore` was dirty after `finalizeRun` returned, which is how this surfaced — the fixture had to pre-seed `.run-logs/` to stop it polluting the assertion.\n\nConsequences, both on the first hench run in a project (the append is idempotent, so it is one-shot per project):\n- The `.gitignore` edit rides the NEXT run's `git add -A` into \"chore: commit local changes before hench run\", attributed to unrelated work — the exact harm the commit-residue work exists to prevent.\n- The next autonomous run (`--auto`/`--loop`/`--epic-by-epic`) sees a dirty tree. Those abort by default without `--allow-dirty`, so hench's own housekeeping write can block the following run.\n\nOptions: (A) write the gitignore entry before the commit step rather than during run-log persistence, so it is part of what the run commits; (B) keep the write where it is but stage it alongside the PRD metadata in `commitCompletionMetadata`; (C) do it at `ndx init` time, where the rest of the project's ignore entries are written, and drop the per-run check entirely — arguably where it belonged, since it is project setup rather than run output.\n\nC looks cleanest but changes behaviour for projects initialised before it lands, so it needs a fallback for the first run in an older project."
lastModified: "2026-08-28T18:59:29.116Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
