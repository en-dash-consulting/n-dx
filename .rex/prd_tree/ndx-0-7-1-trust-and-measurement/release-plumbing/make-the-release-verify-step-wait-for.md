---
id: "e37dfec8-cd4f-49b2-ba52-10aa987ea799"
level: "task"
title: "Make the release verify step wait for npm instead of skipping when the version isn't visible yet"
status: "pending"
priority: "medium"
tags:
  - "release-plumbing"
  - "ci"
source: "ndx-capture"
acceptanceCriteria:
  - "The step decides whether this run published from the changesets action's `published` output, not from npm lookups"
  - "When the run published, the step retries the npm lookup with backoff for a bounded time and fails with a clear error if the version never appears, instead of exiting 0"
  - "When the run did not publish, the step still exits early with its current message"
  - "The npm check covers all six packages in PACKAGES, not only @n-dx/core"
  - "RELEASING.md describes the new behaviour if it documents the verify step"
description: "In .github/workflows/release.yml, the step \"Verify tags and GitHub releases match npm\" (lines 226-232) treats \"is this version on npm?\" as its test for \"did this run publish?\". Right after a publish, the registry can take several minutes to show the new version. On the 0.7.1 release (run 36168208924), changesets logged \"Successfully published\" at 17:44:11, the verify step ran 22 seconds later, got a 404, printed \"@n-dx/core@0.7.1 is not on npm; nothing to verify.\" and exited 0. Tags and releases happened to be fine, but a real tag or release gap on that run would also have passed — the exact failure the step was added to catch. It also checks only @n-dx/core for the whole fixed group."
lastModified: "2026-09-25T17:57:59.542Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
