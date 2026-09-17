---
id: "406b4b7a-eab0-45e0-ba4c-b0b9bc9dc9b9"
level: "feature"
title: "Target-Repo README Generation on ndx init"
status: "completed"
source: "smart-add"
startedAt: "2026-06-01T15:39:02.784Z"
completedAt: "2026-06-01T15:39:02.784Z"
endedAt: "2026-06-01T15:39:02.784Z"
acceptanceCriteria: []
description: "When `ndx init` runs, generate a README for the repository being initialized (not n-dx itself). If no README exists, write README.md; if one exists, write README.proposed.md without touching the original. Today the init flow conflates the host tool's documentation with the target project's, leaving users with either a missing or misleading README."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for target-repo README generation and proposed-file fallback](./add-regression-tests-for-target-0bf221.md) | completed |
| [Generate target-repo README.md from project summary when no README exists during ndx init](./generate-target-repo-readme-md-dbf091.md) | completed |
| [Write README.proposed.md instead of overwriting an existing README during ndx init](./write-readme-proposed-md-625762.md) | completed |
