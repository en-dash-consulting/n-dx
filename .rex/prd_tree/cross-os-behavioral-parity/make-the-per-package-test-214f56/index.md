---
id: "214f5636-f4c2-426b-af58-ba24c4e49a76"
level: "feature"
title: "Make the per-package test suites pass on Windows"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "hench"
  - "web"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "@n-dx/hench passes on Windows with no test weakened to achieve it"
  - "@n-dx/web passes on Windows (after its own triage) with the same constraint"
  - "Every platform-conditional assertion covers BOTH the POSIX and Windows shape, not just whichever one the current machine produces"
  - "No production code was changed to accommodate a test, unless a genuine cross-OS defect was found and recorded as such"
  - "The per-package suites run in the Windows CI job rather than remaining ubuntu-only"
description: "The sibling CI-matrix task (da8af67a) put the ROOT suite on windows-latest but deliberately left `pnpm -r run test` ubuntu-only, because the per-package suites are red on Windows and a permanently-red job gets disabled. This feature closes that gap so per-package tests can join the Windows job.\n\nMeasured on Windows 11 after the masking fix made every package visible for the first time:\n  @n-dx/hench   2851 passed,  32 FAILED  (12 of 151 files)\n  @n-dx/web     2864 passed,   7 FAILED  (4 of 176 files)\n  @n-dx/rex     4416 passed,   2 FAILED  (the ambient-load set, task 676af18f)\n  llm-client and sourcevision are fully green on Windows.\n\nhench's 32 have been triaged in full (see the triage log on task 741bacf1). The headline: ALL 32 are test-side and Windows-specific — zero production bugs. The suite encodes POSIX assumptions in fixtures and assertions while the code under test behaves correctly. Confidence is structural rather than inferred from CI: `C:\\` drive-qualified paths, `\\r\n`, EBUSY on rmdir, and cmd.exe not stripping single quotes cannot occur on POSIX, and the path-separator group passes on POSIX by construction because node's join() yields forward slashes there.\n\nSeven root causes, each with its own task below except where trivially grouped:\n  1. POSIX path separators hardcoded in assertions ....... 15\n  2. Windows prompt-delivery asserted as universal ........ 7\n  3. CRLF from git's core.autocrlf ........................ 3\n  4. POSIX-only fixtures (/tmp, single-quoted echo) ....... 2\n  5. POSIX shell quoting in git fixtures .................. 2\n  6. Windows file locking on temp cleanup (EBUSY) ......... 2\n  7. POSIX absolute-path assumption (startsWith(\"/\")) ..... 1\n\nGOVERNING RULE for this feature: do not make a failure disappear by weakening what the test checks. Two of these groups protect real contracts — prompt delivery (group 2) and rollback file content (group 3) — and a substring match or a stripped assertion would keep the test green while removing its value. Where a platform genuinely behaves differently, assert BOTH shapes rather than neither.\n\nweb's 7 are not yet triaged; they belong under this feature once they are."
---

## Children

| Title | Status |
|-------|--------|
| [Add the per-package suites to the Windows CI job](./add-the-per-package-suites-to-2b2b78.md) | pending |
| [Cover both prompt-delivery shapes per platform in hench adapter tests](./cover-both-prompt-delivery-0de025.md) | completed |
| [Fix POSIX fixture assumptions in hench and web tests (/tmp, git quoting, absolute-path check)](./fix-posix-fixture-assumptions-861495.md) | completed |
| [Fix the hardcoded "/" after join() in web's boundary-check exemptions](./fix-the-hardcoded-after-join-in-30235f.md) | pending |
| [Give web's graph-view tests a getBoundingClientRect stub (jsdom returns 0x0)](./give-web-s-graph-view-tests-a-3be5b1.md) | pending |
| [Make hench and web temp-dir cleanup survive Windows file locking (EBUSY)](./make-hench-and-web-temp-dir-8e7962.md) | pending |
| [Normalize POSIX path-separator assertions in hench test-runner and guard tests](./normalize-posix-path-separator-7c8977.md) | pending |
| [Stop git's autocrlf breaking hench rollback and sigint fixtures](./stop-git-s-autocrlf-breaking-a38d61.md) | pending |
