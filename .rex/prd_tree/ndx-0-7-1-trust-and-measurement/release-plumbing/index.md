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
| [Backfill git tags and GitHub releases for 0.5.x and 0.6.0](./backfill-git-tags-and-github-releases.md) | completed |
| [Close the issues fixed by #370 and triage #375 and #367](./close-the-issues-fixed-by-370-and.md) | pending |
| [Commit the PRD storage migration design document](./commit-the-prd-storage-migration.md) | pending |
| [Diagnose and fix the release workflow so publishes create git tags and GitHub releases](./diagnose-and-fix-the-release-workflow.md) | in_progress |
