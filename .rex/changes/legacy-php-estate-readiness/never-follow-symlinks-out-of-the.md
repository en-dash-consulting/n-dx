---
id: "f9173794-5641-4098-b703-826467da5886"
type: "task"
title: "Never follow symlinks out of the project in sub-analysis discovery and --deep"
slug: "never-follow-symlinks-out-of-the"
summary: "Keep analysis inside the repository being scanned: links to other folders must not pull their results in or get written to, and looping links must not hang the scan."
description: "**Problem.** Inventory, imports and the packs do not follow symlinks, but zone sub-analysis discovery does. `findSubSvDirs` in `packages/sourcevision/src/analyzers/workspace.ts` walks with `statSync` (follows links), with no containment check and no visited set. Measured on invented probes:\n- `vendor-link -> ../outside-proj` (a project with its own `.sourcevision/`) was reported as a sub-analysis and its zones and file paths were **promoted into this project's** `zones.json`, `CONTEXT.md` and `zones/<id>/summary.json`;\n- `--deep` sub-package analysis ran analyze **inside the outside project** through the link, writing its `.sourcevision/`;\n- two self links in one directory (`a/s1 -> .`, `a/s2 -> .`) make the walk branch exponentially: analyze sat in `[phase 4] Zones…` at full CPU for minutes until killed;\n- a link to a large directory is walked entry by entry.\n\n**Fix.**\n- Sub-analysis discovery and `--deep` sub-package discovery never follow a symlinked directory (use `lstat`/`Dirent.isSymbolicLink`), matching the inventory walk. A symlinked directory is never a sub-analysis or sub-package.\n- Belt and braces: any candidate whose realpath is not inside the project root's realpath is rejected, and `--deep` never runs analyze outside the root.\n- Audit every other directory walk in sourcevision and the language packs (`analyzers/sdlc-profile.ts`, `infrastructure.ts`, `outbound-detection.ts`, `util/project-walk.ts`, `export/iso-scan.ts`, lang-kit Composer/project readers, PHP docroot and include-path root discovery, and any other `readdir` recursion). Each must not follow symlinked directories out of the root and must terminate on loops. Fix any that do; list the audit in the task log.\n\n**Tests** (links created in a temp dir by the test, skipped on Windows if the existing suite does that for symlinks): an outside project with `.sourcevision/` linked in is not a sub-analysis, and no outside path appears in any output; `--deep` leaves the outside project's files untouched (mtime); two self links finish within a short bound; a link to an ancestor holding `.sourcevision/` is not taken as a sub-analysis. Existing workspace/sub-analysis tests pass unchanged."
acceptanceCriteria:
  - "A symlinked directory is never a sub-analysis or a --deep sub-package"
  - "No outside path appears in any output and --deep writes nothing outside the root"
  - "Two self-referencing links in one directory finish within a short bound"
  - "Every sourcevision and pack directory walk is audited and none follows a symlinked directory out of the root"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "sourcevision"
  - "privacy"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "4e33c0c3-8233-4480-92eb-d1d74a089ed8"
---
