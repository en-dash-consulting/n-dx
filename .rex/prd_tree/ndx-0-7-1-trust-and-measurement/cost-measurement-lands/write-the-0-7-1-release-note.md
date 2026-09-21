---
id: "4d00ef63-d70a-4afa-9fed-15f2de4c7c04"
level: "task"
title: "Write the 0.7.1 release note explaining the reported-cost change"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "cost-measurement"
  - "wm-2055"
  - "non-code"
blockedBy:
  - "2b86bc48-6cab-4cd1-bc15-b05ee38fc14d"
source: "caos work management: WM2055 (Write the 0.7.1 release note explaining the reported-cost change); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "The changeset for per-model pricing in PR #353 states that reported costs rise and why."
  - "The 0.7.1 GitHub release body opens with a 'Reported costs change' paragraph giving the reason and an example figure."
  - "packages/*/CHANGELOG.md for 0.7.1 carry the same text through the changeset."
description: "Per-model pricing corrects reported costs upward by about 35% (the baseline batch moved from $161.08 at a flat Sonnet rate to $247.53 priced per model). Anyone with a budget alert or dashboard keyed to the old figures will see a jump on upgrade. The change is a patch by semver, so the release note and the changeset summary must carry the explanation.\n\nImplementation notes: Before PR #353 merges, edit its per-model pricing changeset (.changeset/*.md touching @n-dx/llm-client and @n-dx/rex) so the summary states that dashboard and CLI cost figures rise, typically by about a third, because runs are now priced per model instead of at a flat Sonnet rate, and that no tokens were added. After the 0.7.1 publish, ensure the GitHub release body opens with that paragraph (the release workflow builds it from the changelog; edit the release if needed). Non-code."
lastModified: "2026-09-21T17:24:22.513Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
