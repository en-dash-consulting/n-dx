---
id: "dbea1b0f-a865-48dd-adc0-e4c31dde781c"
level: "feature"
title: "Release plumbing"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "release-plumbing"
source: "caos work management: feature ndx 0.7.1 - Release plumbing"
acceptanceCriteria:
  - "Publishing 0.7.1 creates one tag per package and a GitHub release without manual steps."
  - "Tags exist for every 0.5.x and 0.6.0 version at the commit that published it."
  - "Issues #362 to #365 and #368 are closed with a pointer to #370; #375 and #367 each have an owner or a documented deferral."
  - "The migration design document is committed on main."
description: "The release workflow has published 0.5.x and 0.6.0 to npm without creating git tags or GitHub releases; the last tag is 0.4.6 from July 2026, so the repository alone cannot show what shipped. Restore per-package tagging and GitHub releases in the workflow, backfill tags for 0.5.x and 0.6.0 at their Version Packages commits and re-create missing changelog entries, and clear the housekeeping left by the last wave: close issues #362, #363, #364, #365 and #368 (already fixed by #370), triage #375 (rex fix inverts timestamps it cannot repair) and #367 (Windows port relocation), and commit the PRD storage migration design document that is currently untracked.\n\nGoal: Anyone can read the release history from the repository, and the open issue list is a real work list."
lastModified: "2026-09-21T17:24:05.774Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add ndx claim to the README and refresh the CLAUDE.md hench gateway row](./add-ndx-claim-to-the-readme-and.md) | pending |
| [Backfill git tags and GitHub releases for 0.5.x and 0.6.0](./backfill-git-tags-and-github-releases.md) | completed |
| [Close out the 0.7.1 PRD bookkeeping before the cut](./close-out-the-0-7-1-prd-bookkeeping.md) | pending |
| [Close the issues fixed by #370 and triage #375 and #367](./close-the-issues-fixed-by-370-and.md) | completed |
| [Commit the PRD storage migration design document](./commit-the-prd-storage-migration.md) | pending |
| [Confirm hench.promptCacheTtl 1h is accepted by the live Anthropic API before the cut](./confirm-hench-promptcachettl-1h-is.md) | pending |
| [Correct every 0.7.1 changeset against the merged behaviour before the cut](./correct-every-0-7-1-changeset-against.md) | pending |
| [Diagnose and fix the release workflow so publishes create git tags and GitHub releases](./diagnose-and-fix-the-release-workflow.md) | in_progress |
| [Fix rex fix timestamp backfill inverting startedAt/completedAt (#375)](./fix-rex-fix-timestamp-backfill.md) | completed |
| [Reproduce Windows near-port relocation never engaging (#367)](./reproduce-windows-near-port-relocation.md) | pending |
| [Stop the sourcevision cli-hints e2e test timing out under preflight load](./stop-the-sourcevision-cli-hints-e2e.md) | completed |
| [Stop the Windows CI flakes: unset hookTimeout and bypassed rm retries](./stop-the-windows-ci-flakes-unset.md) | completed |
