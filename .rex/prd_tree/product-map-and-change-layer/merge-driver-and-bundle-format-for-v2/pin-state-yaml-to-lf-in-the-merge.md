---
id: "66d88307-0b0e-46b4-ada3-577dbd61ba3b"
level: "task"
title: "Pin state.yaml to LF in the merge-state git test so it passes on Windows"
status: "pending"
priority: "high"
acceptanceCriteria: []
acceptanceCriteria:
  - "The merge-state git test's repository pins its state.yaml files to LF the way ndx init does"
  - "The conflict test still asserts LF conflict markers (no \\r stripping) and passes locally"
  - "No source files or other tests change"
description: "CI failure on PR #589: the CLI Smoke (Windows) job fails packages/rex/tests/integration/merge-state-git.test.ts > \"leaves conflict markers and an unmerged path when nothing decides a status\" (runs 37823069184 and 37829692637; macOS, Linux and local runs pass).\n\nCause: the test's throwaway repo writes a .gitattributes holding only `.rex/product/**/state.yaml merge=rex-state`, with no eol pin. GitHub's Windows runners set core.autocrlf=true, so when the merge conflicts git writes the driver's result to the work tree with CRLF. The markers are right, but the assertion looks for a \\n-joined string ('<<<<<<< ours\\n    status: \"blocked\"\\n=======…') and the file holds \\r\\n. The other tests in the file parse the YAML, so they pass.\n\nReal projects are unaffected: ndx init pins `<rex>/**/*.yaml text eol=lf` through packages/core/gitattributes-pins.js, so state.yaml stays LF on Windows.\n\nFix (test only): make the fixture mirror what ndx init writes. Pin the state files `text eol=lf` alongside `merge=rex-state` (for example `.rex/product/**/state.yaml text eol=lf merge=rex-state`), preferably derived from the same rules ndx init uses (gitattributesEolRules / gitattributesMergeRules) if the rex test can reach them without breaking the tier rules; otherwise write the literal line and say why. Do not weaken the assertion by stripping \\r: the test should show the conflict markers land as LF under the real configuration. Keep the other tests in the file unchanged.\n\nChange only test files; no source change, no changeset. The hench gate runs on macOS and cannot reproduce the Windows failure, so say so in the summary. The sandbox pre-approves only npm, npx, node, git, tsc and vitest commands (e.g. `npx vitest run --root packages/rex tests/integration/merge-state-git.test.ts`), never pnpm."
lastModified: "2026-10-08T19:48:48.898Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
