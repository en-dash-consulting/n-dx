---
id: "318121b4-bdd5-472d-a357-70912937e285"
level: "task"
title: "Migration plan, dry run and apply refuse when the v1 parser skipped an item file"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
source: "review-2026-10-12"
acceptanceCriteria:
  - "rex migrate --plan on the malformed-frontmatter fixture refuses and names the skipped file (test; fails at 4646976bad)"
  - "rex migrate --apply --dry-run on that fixture refuses and names the file (test; fails at 4646976bad)"
  - "rex migrate --apply on that fixture refuses, names the file, and leaves prd_tree/ byte-identical (test; fails at 4646976bad)"
  - "A clean v1 tree plans and applies as before (existing tests pass)"
description: "Review of #689 (2026-10-12), must-fix, CONFIRMED (reproduced in the reviewer's scratchpad pr689/mal). packages/rex/src/cli/commands/migrate.ts:169 loads v1 through load: () => store.loadDocument(); FileAdapter drops parseFolderTree's warnings, so an item with malformed front matter never reaches the lossless check in packages/rex/src/migrations/v1-to-v2/apply.ts:563-571, and apply then rm -rf's prd_tree/ with the item's file in it (apply.ts:718).\n\nFailure scenario: a v1 tree with one good epic and one epic whose index.md front matter is unterminated (fixture packages/rex/tests/fixtures/folder-tree/malformed-frontmatter): 'migrate --plan --rules-only' reports 'Items: 1 area', '--apply --dry-run' reports '1 v1 items' with no warning, '--apply' reports 'Migrated 1 v1 items' and 'Removed prd_tree/', and the broken epic's text is gone from the project. A hand-edit or merge-conflict marker in one index.md on the cut branch does the same. This repository has 0 parseFolderTree warnings today; any project with a malformed item loses it.\n\nFix: load through parseFolderTree (or a store method that returns its warnings) and refuse plan, dry run and apply while any warning names a malformed or unreadable item file, naming each file in the refusal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:13:44.639Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
