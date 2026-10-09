---
id: "26fc9b94-584c-4dc1-966b-395b83da7c33"
level: "task"
title: "Skill commits name their paths and read unquoted status paths"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-09T16:51:06.719Z"
completedAt: "2026-10-09T16:55:15.611Z"
endedAt: "2026-10-09T16:55:15.611Z"
acceptanceCriteria:
  - "Every skill commit step and the SKILLS.md template commit with `git commit -F .ndx-commit-msg.txt -- <the same paths>`; tests/e2e/skill-commit-isolation.test.js checks it"
  - "Every skill and the template read status with `git -c core.quotepath=false status --porcelain --untracked-files=all` for both the starting list and the commit-time list (static test)"
  - "tests/integration/skill-commit-behavior.test.js: a path the user had already staged before the skill ran is not in the skill's commit and stays staged; a new file with a non-ASCII name the skill wrote is committed"
  - "The generated .claude/skills and .agents/skills copies match the sources (tests/e2e/skill-sync.test.js)"
description: "From Hal's (endash-shal) adversarial review of #619 (2026-10-09), two findings on the skill commit step, same text in all six committing skills, both generated copies and the SKILLS.md template. (1) must-fix, ndx-work.md:25: `git commit -F .ndx-commit-msg.txt` with no pathspec commits the whole index, so a path the user had already `git add`-ed before the skill ran goes into the skill's commit, silently. Fix: commit with the same paths it staged, `git commit -F .ndx-commit-msg.txt -- <the same paths>`, as hench's commitPrdTreeIfStaged already does; word the fallback as 'stays out of this commit' (an index entry is not unstaged). (2) should-fix, ndx-work.md:15: `git status --porcelain` quotes any path with non-ASCII, a quote, a backslash or a control character (core.quotepath), and `git add --` does not match the quoted form, so one such path aborts the whole staging step (exit 128). Reachable for /ndx-work on a project's own source files; PRD slugs are ASCII. Fix: read both the starting list and the commit-time list with `git -c core.quotepath=false status --porcelain --untracked-files=all`. Runs as an assisted /ndx-work (skill sources and .claude/ copies)."
lastModified: "2026-10-09T16:55:15.883Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
