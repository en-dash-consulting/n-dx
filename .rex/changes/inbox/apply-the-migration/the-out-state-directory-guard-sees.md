---
id: "aab77339-7b6b-4a95-b1aa-0d02eb820f48"
type: "task"
title: "The --out state-directory guard sees through Windows short-name aliases"
slug: "the-out-state-directory-guard-sees"
description: "Found by Windows CI on the v2 migrate stack (2026-10-20, job Tests (Windows, rex+sourcevision) on #797 and every layer above). Two tests fail on Windows only: cli-migrate-plan.test.ts 'refuses the real-path alias of the rex directory (/tmp vs /private/tmp)' (rex migrate-plan --out=C:\\\\Users\\\\runneradmin\\\\...\\\\.rex\\\\plan.json with the project given as C:\\\\Users\\\\RUNNER~1\\\\... unexpectedly succeeded) and cli-prd-bundle.test.ts 'refuses a symlink to .rex, a real-path alias of it, and .ndx/ on a legacy layout' (rex export wrote the bundle inside .rex). Cause: packages/rex/src/cli/commands/export.ts canonicalPath resolves with fs.realpathSync, which on Windows does not expand 8.3 short names (RUNNER~1), so the guard compares C:\\\\Users\\\\RUNNER~1\\\\... with C:\\\\Users\\\\runneradmin\\\\... and misses the alias. assertOutsideRexDir (used by rex export, rex migrate-plan --out/--summary and rex tree-diff) inherits the gap. Smallest fix: fs.realpathSync.native, which resolves short names on Windows and behaves the same elsewhere. Product fix (Windows only); the guard is a soft-freeze CLI behaviour, so the changeset says so."
acceptanceCriteria:
  - "rex migrate-plan --out and rex export refuse a path inside the rex directory when the project or the output path uses a Windows 8.3 short-name alias (the two failing tests pass on Windows CI)"
  - "canonicalPath resolves with realpathSync.native; macOS and Linux behaviour is unchanged (existing tests pass)"
  - "The changeset notes the Windows guard fix"
priority: "high"
tags:
  - "lane-migration"
  - "rex"
  - "windows"
  - "v2-migrate-ci"
source: "Windows CI on the v2 migrate stack, 2026-10-20"
---
