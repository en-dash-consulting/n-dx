---
id: "e37dfec8-cd4f-49b2-ba52-10aa987ea799"
type: "task"
title: "Make the release verify step wait for npm instead of skipping when the version isn't visible yet"
slug: "make-the-release-verify-step-wait-for"
description: "In .github/workflows/release.yml, the step \"Verify tags and GitHub releases match npm\" (lines 226-232) treats \"is this version on npm?\" as its test for \"did this run publish?\". Right after a publish, the registry can take several minutes to show the new version. On the 0.7.1 release (run 36168208924), changesets logged \"Successfully published\" at 17:44:11, the verify step ran 22 seconds later, got a 404, printed \"@n-dx/core@0.7.1 is not on npm; nothing to verify.\" and exited 0. Tags and releases happened to be fine, but a real tag or release gap on that run would also have passed — the exact failure the step was added to catch. It also checks only @n-dx/core for the whole fixed group.\n\nOperator note (overnight 2026-10-15): changesets/action v2 at the pinned SHA ae32849 exposes the outputs `published` (\"true\"/\"false\") and `published-packages` (JSON array of {name, version}); use `steps.changesets.outputs.published`. Move the decision and retry logic out of inline shell into a script the step calls (for example scripts/verify-release-sync.mjs), and give it a root unit test under tests/unit/ that injects the npm, git and gh lookups and the sleep function, so no test spawns a process or waits in real time (wall-clock-inventory-policy, shell-spawn-inventory-policy: register any new spawn in tests/shell-spawn-inventory.md). Cover: not published -> exit 0 with the current message; published and the version appears after some retries -> tag and release checks run; published and the version never appears within the bound -> non-zero exit with a clear error; every package in PACKAGES checked on npm. Never run the release workflow, push a tag or publish anything. Files: .github/workflows/release.yml, the new script and its test, RELEASING.md. Do not touch packages/, README.md or docs/guide/commands.md. Run the six static root policy tests (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy) before committing."
acceptanceCriteria:
  - "The step decides whether this run published from the changesets action's `published` output, not from npm lookups"
  - "When the run published, the step retries the npm lookup with backoff for a bounded time and fails with a clear error if the version never appears, instead of exiting 0"
  - "When the run did not publish, the step still exits early with its current message"
  - "The npm check covers all six packages in PACKAGES, not only @n-dx/core"
  - "RELEASING.md describes the new behaviour if it documents the verify step"
priority: "medium"
tags:
  - "release-plumbing"
  - "ci"
source: "ndx-capture"
---
