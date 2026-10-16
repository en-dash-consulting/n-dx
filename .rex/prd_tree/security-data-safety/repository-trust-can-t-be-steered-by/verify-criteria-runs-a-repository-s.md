---
id: "48f5ce09-04a9-4585-86f2-a432576e3b34"
level: "task"
title: "verify_criteria runs a repository's test command only once its digest is accepted"
status: "pending"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #686 (finding 2)"
  - "verify_criteria with runTests=true runs a repository's test command only when a trust record exists whose digest matches the current execution config; a baseline-state checkout with a test command and no record is refused with the existing testsSkipped note"
  - "The refusal names `ndx trust accept .`, and after accepting, the same call runs the command"
  - "Test with a plain, non-chained test command (for example `node -e \"…\"` writing a marker file) proves it does not run before acceptance and does run after; the test fails on origin/main 9f6a0e963"
  - "The verify_criteria result keeps its existing fields; no new MCP tool fields"
description: "#686 finding 2 (high, must-fix):\n\n> `repo-trust.ts` reports `.rex/config.json`'s `test` command as a `test-command` finding, but only at **`warning`** severity when it matches `SHELL_RISK` (chaining or fetching). A plain `node -e \"…\"` or `pnpm test` is `info`, so the checkout stays unrestricted. Rex's `verify_criteria` (`packages/rex/src/cli/mcp-tools/verify-criteria.ts`) runs tests when `runTests` is true and `!trust.restricted`, so a repository-supplied plain command executes with no `ndx trust accept .`. That contradicts the comment, which says tests run only once the execution config is trusted.\n>\n> **Fix:** treat any repository-owned test command as needing trust (an accepted digest) before `verify_criteria` runs it. Add a test with a plain, non-chained command.\n\nReproduced 2026-10-16 on the built origin/main: `.rex/config.json` with `test: node -e \"process.exit(0)\"` evaluates `baseline`, unrestricted, `test-command` at `info`, so verify_criteria would run it.\n\n`ndx trust accept .` already records a digest on a baseline checkout (\"Recorded anyway\"), so the gate can require a trust record whose digest matches the current config whenever a test command is present, rather than `!restricted`. The skipped-tests note in the result tells the user to run `ndx trust accept .`. verify_criteria is a rex MCP tool and MCP tool shapes are soft-frozen: the new refusal is a behaviour change, so it gets a release-note line in the layer's changeset (written with the PR, not in this task). Keep the result shape: the existing `testsSkipped` and `trust` fields carry the refusal; add no new fields."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:27:41.563Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
