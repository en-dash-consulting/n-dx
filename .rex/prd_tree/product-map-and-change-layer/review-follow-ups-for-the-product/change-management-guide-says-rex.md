---
id: "db4f7321-0e69-4105-b159-f9f0e862df8b"
level: "task"
title: "change-management guide says rex remove archives items and rex restore <item-id> recovers them; neither is true"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "docs"
  - "pr-28"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "docs/guide/change-management.md does not say `rex remove` writes .rex/archive.json"
  - "docs/guide/change-management.md does not show `rex restore <item-id>`; any `rex restore` usage matches the command's real arguments and snapshot semantics"
  - "every claim the guide makes about what `ndx plan --accept` does with old items matches the code"
  - "`npx vitepress build docs` passes"
description: "Out-of-scope finding from the adversarial review of c380c2fa. This was already in the guide; that task's edits just made it visible.\n\nFailure scenario: a user follows docs/guide/change-management.md (\"Archive management\" and \"Pitfall 1: Over-pruning\"). They run `rex remove <epic-id>` expecting the item to go to `.rex/archive.json`, then run `rex restore <epic-id>`. But packages/rex/src/cli/commands/remove.ts never touches the archive; only prune, reshape and reorganize write archive.json. And restore.ts rolls the whole tree back to a backup snapshot (core/backup-snapshots.ts); it does not take an item id. The user's recovery step does not do what the guide promises. The same section also claims `ndx plan --accept` moves old items to the archive, and that claim is unverified.\n\nWho can hit it: anyone reading the guide (it is in the VitePress sidebar). No test checks this prose.\n\nOptions: (1, recommended) Rewrite the archive and recovery sections against the real behaviour: recovery for `rex remove` is git (`git checkout -- .rex/prd_tree/` or `git revert`), and `rex restore` restores a tree snapshot. Docs only, cheap. (2) Fold it into the sibling task \"Rewrite the guides, package pages and examples for the v2 model\"."
lastModified: "2026-10-10T05:28:56.814Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
