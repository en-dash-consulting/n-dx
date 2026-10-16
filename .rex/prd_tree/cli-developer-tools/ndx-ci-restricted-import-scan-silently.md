---
id: "5d63a742-9729-495e-8a3d-ee541fd0fe25"
level: "task"
title: "`ndx ci` restricted-import scan silently skips an unreadable directory outside git, so an enforced rule passes unread"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Outside a git work tree, with ci.restrictedImports configured and a source directory made unreadable (chmod 000, POSIX only), `ndx ci --format=json` exits 1 and the architecture-policy step's violation names the directory and the read error (test)"
  - "A readable non-git project's architecture-policy step result is unchanged"
description: "Verdict: out-of-scope (pre-existing), found in the adversarial review of 475f175a.\n\nScenario: a project that is not a git work tree (or whose dir git ignores) has ci.restrictedImports configured and a source directory it cannot read (chmod 000, root-owned). packages/core/ci.js walkFiles catches readdirSync errors with `catch { return; }`, so the directory's files never become candidates. The architecture-policy step reports ok, with a lower `checked` count, although the rule never read those files. 475f175a made unreadable *files* fail the step; this is the same silent pass one level up.\n\nReachable: `ndx ci` outside git (the walk fallback in scanRestrictedImports). Rare. Inside git, tracked files under an unreadable dir are listed by `git ls-files`, and the scan now fails them loudly.\n\nOptions:\n1. Recommended: have walkFiles return the directories it could not read, and have scanRestrictedImports report them as unreadable (\"cannot read <dir>/: EACCES …\") so the step fails. Cheap.\n2. Leave as is. The rule passes over the directory silently."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T23:20:18.046Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
