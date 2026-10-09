---
id: "984f45ac-a771-43e5-b17e-9f4cfea04ff8"
level: "task"
title: "The .gitignore guide's snippets drift from the ndx.gitignore template"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "docs/guide/gitignore.md and docs/guide/existing-project.md list every entry in packages/core/assistant-assets/ndx.gitignore, including .ndx-commit-msg.txt"
  - "Neither page names .rex/prd.json.lock"
  - "A root unit test fails when a docs gitignore snippet drops an entry the template lists"
description: "Found by the adversarial review of task 92230d04 (gitignore the skill commit-message scratch file). Verdict: out-of-scope (pre-existing drift; this change only widened it).\n\nProblem: docs/guide/gitignore.md (snippet ~line 30 and table ~line 79) and docs/guide/existing-project.md (~line 81) hand-copy the template at packages/core/assistant-assets/ndx.gitignore, and nothing checks the copies. They are now missing `.ndx-commit-msg.txt`, `.hench/reviews/`, `.hench/mcp/` and `.hench/recovery/`, and they still name `.rex/prd.json.lock`, a lock file that is no longer written (tests/unit/ndx-gitignore-template.test.js keeps it out of the template).\n\nScenario: a user pastes the guide's snippet into their own .gitignore. A failed `git commit -F .ndx-commit-msg.txt` leaves the scratch file behind, and the next `git add -A` commits it, along with the other missing runtime artifacts.\n\nReachability: any user who follows the docs instead of copying the template.\n\nOptions:\n(a) Recommended: extend tests/unit/ndx-gitignore-template.test.js to parse the fenced gitignore blocks in both docs pages and require them to match the template's entries. Cost: one test plus a docs refresh.\n(b) Replace the snippets with a link to the template. This removes the copy-paste convenience."
lastModified: "2026-10-09T05:14:44.173Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
