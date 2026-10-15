---
id: "b47ad199-5cf5-4926-98d5-5aa5148b1127"
level: "task"
title: "Four source files hold a NUL byte, so git shows them as binary and their diffs cannot be reviewed"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "ci-reliability"
source: "ndx-adversarial-review"
startedAt: "2026-10-15T13:09:47.341Z"
completedAt: "2026-10-15T13:09:47.341Z"
endedAt: "2026-10-15T13:09:47.341Z"
acceptanceCriteria:
  - "packages/hench/src/agent/analysis/livelock.ts, packages/rex/src/core/slug-migration.ts, packages/sourcevision/src/cli/commands/analyze-phases.ts and packages/web/tests/unit/server/prd-refinement.test.ts contain no NUL byte"
  - "Each separator is written as an escape, so the composite keys those files build are byte-identical at runtime and their existing tests pass unchanged"
  - "The KNOWN set in tests/e2e/source-nul-bytes.test.js is empty, and the guard's third case (which fails on a stale entry) still passes"
  - "git diff on each of the four files prints a text diff rather than 'Bin N bytes'"
description: "Found by the adversarial review of the Group B sourcevision branch, 2026-10-14. Verdict: out-of-scope for that change and filed separately. **Sequencing: do this after Group D is pushed**, so it does not collide with the group branches in flight.\n\n**Failure.** Each of these four files uses a raw NUL byte as a separator inside a template literal or a split() call. The value is sound: a NUL cannot occur in an identifier, so the composite key is unambiguous. The cost is review. Git's binary heuristic keys on NUL, so a file holding one is classified binary: 'git diff' and 'git show' print 'Bin N bytes' and GitHub renders 'Binary file not shown'. Any future change to these files arrives in a pull request with nothing to read.\n\n**Reachability.** Every pull request touching them. This is not hypothetical — the same pattern in three new sourcevision modules would have put roughly a thousand lines of new analysis code into PR #739 unreviewable, which is how the class was found.\n\n**Why nothing catches it.** Typecheck passes and the tests over these modules pass, because the program is correct. No runtime assertion can reach a defect whose only symptom is a reviewer seeing nothing. tests/e2e/source-nul-bytes.test.js (added in #739) now guards new occurrences; these four are listed in its KNOWN set so the guard could ship green.\n\n**The files, and what each uses the NUL for.** livelock.ts: joining tool name, args and result into an observation signature. slug-migration.ts: pairing a slug with an item id. analyze-phases.ts: joining zone names with finding and insight counts. prd-refinement.test.ts: the same shape in a fixture.\n\n**Options.** (a) Recommended: replace each raw byte with its escape, exactly as #739 did for typed-findings.ts, declared-rules.ts and rerun-judge.ts. The escape is the identical string at runtime, so no behaviour changes and no test needs updating; then empty the KNOWN set. Cost: four one-line edits across three packages plus the set. Risk: none beyond touching four packages in one change. (b) Pick a printable separator instead. Rejected: it changes the key bytes, so any persisted or cached value keyed on the old separator silently stops matching. (c) Leave them allowlisted. Rejected: the allowlist exists to let the guard ship, not to make the debt permanent, and its third assertion is written so entries can only be removed.\n\nSeverity: medium — no runtime defect, but it blocks review of four files across three packages, and review is the control this repository leans on hardest."
lastModified: "2026-10-15T13:09:47.924Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
