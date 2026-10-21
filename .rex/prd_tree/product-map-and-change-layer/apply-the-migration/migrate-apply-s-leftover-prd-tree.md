---
id: "793b3a8f-b789-451f-ac69-4c61f3d41f86"
level: "task"
title: "migrate-apply's leftover prd_tree/ tests restore the v1 files on Windows"
status: "pending"
priority: "high"
tags:
  - "lane-migration"
  - "rex"
  - "windows"
  - "v2-migrate-ci"
source: "Windows CI on the v2 migrate stack, 2026-10-20"
acceptanceCriteria:
  - "The three 'a prd_tree/ left beside the v2 tree' tests in migrate-apply.test.ts restore the leftover on Windows (snapshot keys relative and forward-slashed, as in apply.test.ts)"
  - "A unit check of the key helper under node:path's win32 flavour pins the forward-slashed key"
  - "No production code changes"
description: "Found by Windows CI on the v2 migrate stack (2026-10-20, job Tests (Windows, rex+sourcevision) on #795 and every layer above). Three tests in packages/rex/tests/unit/cli/commands/migrate-apply.test.ts under 'a prd_tree/ left beside the v2 tree' fail on Windows only: the dry run reports 'this project already uses the v2 layout: nothing to apply', and the refusal cases get no CLIError. Cause: the test's leftover() helper copies the v1 files back with snapshot(), which keys files by p.slice(dir.length), so on Windows the keys read \\\\prd_tree\\\\... and the startsWith('/prd_tree') filter restores nothing; no leftover exists, so nothing is refused or removed. The production code is fine: the same scenarios in apply.test.ts pass on Windows since d62c25109 / 98a44cf28 normalised that file's snapshot keys. Fix the same way here: relative, forward-slashed keys (a snapshotKey helper like apply.test.ts's), test-only. Keep it minimal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-21T14:26:07.818Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
