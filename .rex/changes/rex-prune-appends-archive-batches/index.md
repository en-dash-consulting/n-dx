---
id: "536d6c7e-fb88-47bb-9a5f-28b2a10b2209"
type: "change"
title: "rex prune appends archive batches without trimming the archive"
slug: "rex-prune-appends-archive-batches"
intent: "packages/rex/src/cli/commands/prune.ts (~301, ~433, ~608) pushes archive batches without `trimArchive`, while core/archive.ts `appendArchiveBatch` and reshape.ts (~377) both trim. Repeated prunes grow `.rex/archive.json` without bound.\n\nReachable: yes, every `rex prune` that archives items.\n\nFix options: (1, recommended) route prune's writes through appendArchiveBatch; small, shares the existing cap. (2) call trimArchive at each prune site; duplicates logic.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "rex prune keeps the archive within the same cap the other archive writers enforce"
  - "A test prunes past the cap and asserts the archive is trimmed"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "medium"
source: "ndx-adversarial-review"
---
