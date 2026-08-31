---
id: "8d80f006-9ca7-4d9e-89a7-1b3f16bf1f6c"
level: "task"
title: "Zone cohesion gate silently passes in CI instead of reporting it did not run"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "A gate whose input artifacts are missing is reported as skipped, not passed"
  - "The chosen approach is applied consistently to every existsSync early-return in architecture-policy.test.js"
  - "If CI is meant to enforce these gates, an analysis step runs before the root suite so zonesDir exists"
  - "A note records which architecture gates are enforced in CI and which are developer-machine only"
description: "tests/e2e/architecture-policy.test.js:878 begins `if (!existsSync(zonesDir)) return`, so when .sourcevision/zones is absent the test reports pass. .sourcevision/* is gitignored (only .gitignore and hints.md are tracked) and no CI step runs `ndx analyze`, so the gate has never actually executed in CI — it is green because it checked nothing. It only fails on a developer machine that has run an analysis locally, which is how the hench-agent cohesion violation went unnoticed. The same `existsSync(...) return` shape appears at roughly 11 places in that file, so the fix is a file-wide decision rather than a one-liner: either mark these skipped (ctx.skip) so the output distinguishes 'not run' from 'passed', or make CI produce the analysis artifacts the gates need before the root suite runs."
lastModified: "2026-08-31T23:00:58.485Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
