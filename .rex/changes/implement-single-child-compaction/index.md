---
id: "f2f52014-a452-4e7d-9665-73649f549473"
type: "change"
title: "Implement single-child compaction migration pass in `ndx reshape` to flatten existing over-wrapped directories"
slug: "implement-single-child-compaction"
intent: "Add a compaction step to `ndx reshape` that scans the existing `.rex/prd_tree/` for directories containing exactly one non-index child file plus an index.md, then collapses them: the child file is moved up to the grandparent directory and the now-empty wrapper directory (with its index.md) is removed. The reshape command should report how many directories were compacted. The migration must be idempotent — running reshape twice on an already-compacted tree produces no further changes and no errors."
acceptanceCriteria:
  - "`ndx reshape` detects and collapses all directories matching the single-child + index.md pattern in the current prd_tree"
  - "After compaction, the collapsed child item is accessible by all rex read commands (status, next, get_item) with correct parent attribution"
  - "Running `ndx reshape` a second time on an already-compacted tree makes zero changes and exits cleanly"
  - "Reshape output includes a count of directories compacted (or 'nothing to compact' when none found)"
  - "If a wrapper directory's index.md contains metadata not present on the child, that metadata is merged into the child's frontmatter before deletion"
  - "reshape detects all folders containing exactly one named file and one index.md"
  - "reshape deletes the index.md from each such folder and logs each removal"
  - "Named file content is verified parseable and data-complete before index.md is removed"
  - "reshape is idempotent: re-running on an already-cleaned tree produces no changes and exits cleanly"
  - "Archive entry is written for each removed index.md so the operation is auditable and reversible"
touches:
  - "84a54eee-5e54-43c0-8232-fa8929e64e33"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "migration"
  - "folder-tree"
  - "prd-storage"
  - "bug"
source: "smart-add"
---
