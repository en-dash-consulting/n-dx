---
id: "9b35685f-f446-4614-b970-bd05be16f9b7"
level: "task"
title: "Backfill git tags and GitHub releases for 0.5.x and 0.6.0"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "wm-2036"
  - "non-code"
blockedBy:
  - "9d6aa8c8-3ba4-42b2-bb6c-5474a858da2b"
source: "caos work management: WM2036 (Backfill git tags and GitHub releases for 0.5.x and 0.6.0); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "`git tag --list '@n-dx/*'` shows every version each package has on npm (`npm view @n-dx/<pkg> versions`)."
  - "Each tag points at the Version Packages merge commit that published that version."
  - "`gh release list` shows a release per tag with the changelog section as its body."
  - "Every version has a CHANGELOG.md entry in each package."
description: "The published versions between 0.4.6 and 0.7.0 exist only on npm. Create the missing annotated tags at the commits that published them (the merges of the 'chore: version packages' PRs, for example #355 for 0.6.0) so the repository history matches the registry, and create matching GitHub releases whose bodies are the CHANGELOG.md sections for that version. Where a changelog entry is missing for a version, re-create it from the changesets that were consumed in that Version Packages commit.\n\nImplementation notes: For each version of each @n-dx package that exists on npm but has no git tag (compare `npm view @n-dx/<pkg> versions --json` with `git tag --list '@n-dx/*'`), find the merge commit of the 'chore: version packages' PR that set that version in packages/<pkg>/package.json (`git log -S'\"version\": \"<v>\"' -- packages/<pkg>/package.json`). Create an annotated tag named `@n-dx/<pkg>@<v>` at that commit with the message the changesets action would have used, push the tags, and create a GitHub release per tag with `gh release create` using the matching section of packages/<pkg>/CHANGELOG.md as the body. If a version lacks a CHANGELOG section, reconstruct it from the .changeset files deleted in that commit and add it in a docs-only PR. Do this after the workflow fix has merged so the two do not collide on the 0.7.1 tags. No code changes; no changeset needed."
lastModified: "2026-09-21T17:24:09.936Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
