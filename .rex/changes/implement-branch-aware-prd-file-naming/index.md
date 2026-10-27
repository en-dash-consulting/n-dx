---
id: "e7e01442-70f8-42bf-8763-d31afb20acf9"
type: "change"
title: "Implement branch-aware PRD file naming convention and git branch/commit resolution"
slug: "implement-branch-aware-prd-file-naming"
intent: "Add utility functions to detect the current git branch name, resolve the date of the branch's first commit, sanitize branch names for filesystem use (slashes, special characters), and generate filenames in the prd_{branch}_{date} format. Handle edge cases like detached HEAD, branches with path separators, and repositories with no commits yet."
acceptanceCriteria:
  - "Generates filenames matching the pattern prd_{sanitized-branch}_{YYYY-MM-DD}.json"
  - "Branch names with slashes and special characters are sanitized to filesystem-safe equivalents"
  - "Detached HEAD state falls back to a deterministic identifier rather than crashing"
  - "First-commit date is extracted from git log for the current branch"
  - "Returns consistent filename when called multiple times on the same branch"
amends: [{"target":"f648a519-2015-486a-849f-782ba79e970f","delta":"modified","summary":"Implement branch-aware PRD file naming convention and git branch/commit resolution","base":"bf1f4510bda04991cbee3442f87f02cc02ed516a47b80e3495c9910f3a242350"}]
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "git"
source: "smart-add"
---
