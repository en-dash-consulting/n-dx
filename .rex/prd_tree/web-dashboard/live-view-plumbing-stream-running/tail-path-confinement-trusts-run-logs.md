---
id: "2bcbcc39-2be5-4955-83f0-a468983a7bbd"
level: "task"
title: "Tail path confinement trusts .run-logs or .hench/runs when the directory itself is a symlink"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T17:10:39.255Z"
completedAt: "2026-10-01T17:33:09.307Z"
endedAt: "2026-10-01T17:33:09.307Z"
resolutionType: "code-change"
resolutionDetail: "confineTailPath realpaths the worktree root, then accepts an allowed dir only if realpath(dir) === dir; tests for symlinked .run-logs/.hench (unit) and a 404 route case. Commit ebd7c39f3."
acceptanceCriteria:
  - "A tail request whose allowed directory is a symlink is refused with 404 (unit test with a symlinked .run-logs)."
  - "Existing confinement tests pass."
description: "Failure: `confineTailPath` in `packages/web/src/server/run-tail.ts:104-108` compares the file's realpath with `realpathOrNull(dir)`. If `.run-logs` (or `.hench/runs`) is itself a symlink to `~/.ssh`, the allowed area becomes `~/.ssh`; the reviewer confirmed that `<root>/.run-logs -> /secret/` made `confineTailPath(<root>/.run-logs/id_rsa)` return the secret. Trigger: a cloned repository commits `.run-logs` as a symlink plus a `.hench/runs/<id>.json` whose `logPath` points into it (git tracks symlinks; .gitignore does not affect tracked files). The data goes only to the local user, so real exfiltration needs a second channel such as the DNS-rebinding gap filed as a GitHub issue. Everything else in confinement held: run ids are validated, `path.relative` is used rather than a string prefix, file symlinks out are refused, recorded paths are re-confined.\n\nVerdict: should-fix (severity low; cheap and the module's docs promise it).\n\nOptions:\n- Recommended: refuse when `lstat(dir).isSymbolicLink()` or `realpath(dir) !== resolve(dir)` (with the worktree root realpath'd first). About 5 lines plus a test."
lastModified: "2026-10-01T17:33:09.821Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
