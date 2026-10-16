---
id: "e2459bea-4cb9-4787-9667-7f634787dcde"
level: "task"
title: "rex migrate-slugs on a v2 tree tells you to run rex migrate-to-folder-tree, a v1 command"
status: "pending"
priority: "low"
tags:
  - "lane-migration"
  - "rex"
source: "v2 migrate stack session 2026-10-15"
acceptanceCriteria:
  - "rex migrate-slugs on a v2 tree says slugs are frozen on v2 (or that it applies to v1 trees only) and exits non-zero without naming migrate-to-folder-tree"
  - "A rex CLI test covers the v2 case"
description: "From the review of Hal's migration PRs (2026-10-15, workshop analysis/hal-migration-prs-review-2026-10-15, item 4). rex migrate-slugs resolves the v1 FileStore whatever the layout; on a v2 tree it answers \"Run 'rex migrate-to-folder-tree' first\", which is a v1 command and wrong advice. It goes away with 2ea252fe (remove the old migrate commands); until then the message should name the v2 case. Not in the release-N stack."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T00:07:23.049Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
