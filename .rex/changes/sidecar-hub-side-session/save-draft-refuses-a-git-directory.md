---
id: "4704cdf5-d927-44d5-aea8-0147a5bce9f1"
type: "task"
title: "save_draft refuses a .git directory whatever its case or spelling"
slug: "save-draft-refuses-a-git-directory"
description: "Review of #948, finding F3. resolveDraftPath (src/server/sidecar/draft-file.ts) compares path segments to .git case-sensitively, so on a case-insensitive filesystem (NTFS, default APFS) .GIT/hooks/x is accepted and written into .git/hooks. The broker re-checks an edited card path through the same function."
acceptanceCriteria:
  - "resolveDraftPath refuses a path with any segment equal to .git compared case-insensitively after stripping trailing dots and spaces (.GIT, .Git, '.git ', '.git.')"
  - "resolveDraftPath also resolves the nearest existing ancestor with realpathSync.native and refuses when that real path has a .git segment, so a symlink or 8.3 short name into .git is refused"
  - "Tests cover .GIT, a trailing-dot and a trailing-space spelling, and a symlinked directory pointing into a .git directory, in the draft-file unit tests and in the broker's edited-path test"
  - "The draft-file.ts header and the web-server.md sentence about the .git refusal state what the check now does"
priority: "medium"
source: "adversarial-review"
---
