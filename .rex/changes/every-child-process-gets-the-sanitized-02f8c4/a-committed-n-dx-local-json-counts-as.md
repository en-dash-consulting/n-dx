---
id: "3e9eafaa-ceae-4a1c-a5a3-9dd121698c14"
type: "task"
title: "A committed .n-dx.local.json counts as repository config under a case variant or behind a symlinked .ndx"
slug: "a-committed-n-dx-local-json-counts-as"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding A (critical, must-fix; introduced by 0681b775; reproduced on the built L2 head).\n\nFailure scenario (case): a repository commits `.N-DX.local.json` (any case variant). On a case-insensitive filesystem (macOS, Windows) existsSync(\".n-dx.local.json\") is true, but `git ls-files --error-unmatch -- .n-dx.local.json` matches pathspecs case-sensitively (even with core.ignorecase) and exits 1, so the file reads as untracked: the user's own config. It applies with no trust review and stays out of the digest; the checkout evaluates baseline.\n\nFailure scenario (symlink): the repository commits `cfg/config.local.json` and a symlink `.ndx -> cfg`. detectLayoutMode (packages/llm-client/src/layout.ts:145) follows the symlink and picks the .ndx layout; git does not list paths beyond a symlink, so `.ndx/config.local.json` reads as untracked. Same result on every OS.\n\nReproduced: case variant → `tracked? false | state baseline`, and a repository-allowed variable reaches repoCommandEnv's child. The orchestration pass reached a marker-writing binary through it via discoverClaudeCli (ndx init), `graview check`, the dashboard's live vendor probe and resolveVendorCliPath; loadLLMConfig returned the file's cli_path and api_endpoint.\n\nWhere: packages/llm-client/src/repo-trust.ts:449 (localConfigTrackState → gitTracksPath) and the second copy in packages/core/gitignore.js:61 (isGitTrackedOrUnanswered), used by packages/core/claude-integration.js:489.\n\nOptions: (a) one helper in llm-client that answers \"tracked\" when git lists the path case-insensitively (`:(icase)` pathspec, confirmed to match) or when any component between the root and the file is a symlink (lstat walk, or realpath differs from the path); core calls it through its existing route rather than keeping its own copy. (b) Take the on-disk name from fs.realpathSync.native and ask git about that. Recommended: (a), symlink rule included, so both readers share one answer; also consider detectLayoutMode refusing a symlinked .ndx."
acceptanceCriteria:
  - "Closes #686 (follow-up): a local config file the repository ships is repository config however it is named or reached"
  - "A committed case variant of .n-dx.local.json, and a config.local.json reached through a committed symlinked .ndx container, both read as tracked: gated until trusted and part of the digest"
  - "packages/core's tracked check gives the same answer as llm-client's (one implementation, no second copy)"
  - "Test: each of the two shapes in a temp git repo evaluates untrusted and its cli_path / guard.env.allow do not apply; the tests fail on the code before the fix (case test skipped where the filesystem is case-sensitive)"
priority: "critical"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:critical"
source: "ndx-adversarial-review"
---
