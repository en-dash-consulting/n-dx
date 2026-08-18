---
id: "7c897777-eb2e-42a0-bb80-0f33a84b7713"
level: "task"
title: "Normalize POSIX path-separator assertions in hench test-runner and guard tests"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "hench"
  - "paths"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "All 15 path-separator failures pass on Windows"
  - "Assertions remain exact — no substring, regex, or basename-only matching was introduced to avoid separators"
  - "The src -> tests mirror expectations (test-runner.ts:127-135) are still asserted in full"
  - "A single shared normalization approach is used rather than 15 independent edits"
  - "The same tests still pass on POSIX"
  - "The open question about findRelevantTests returning OS-native paths to buildScopedCommand is either verified as harmless or filed as its own defect"
description: "Fifteen failures — the largest group — all of the same shape:\n  expected [ 'src\\agent\\loop.test.ts' ] to deeply equal [ 'src/agent/loop.test.ts' ]\n\nDistribution:\n  tests/unit/tools/test-runner.test.ts ...... 10  (candidateTestPaths + findRelevantTests)\n  tests/unit/guard/paths.test.ts .............. 4  (validatePath)\n  tests/unit/tools/go-test-runner.test.ts ..... 1  (candidateTestPaths .ts variants)\n\nTHE PRODUCTION CODE IS CORRECT — this was checked specifically, not assumed. candidateTestPaths()\n(packages/hench/src/tools/test-runner.ts:100-138) builds paths with path.join(), so OS-native\nseparators are the right output. The dangerous possibility was that these paths get compared against\ngit output, which reports FORWARD slashes even on Windows — that would be a silent no-match bug where\nhench quietly skips every relevant test. It does not happen: findRelevantTests() (test-runner.ts:157-174)\nnormalize()s each candidate and then stat()s it on the filesystem, and Windows accepts backslashes.\nDiscovery works correctly on Windows today.\n\nguard/paths.test.ts is the same class from the other direction: the fixtures pass \"/project\" as a fake\nproject root, and path.resolve turns that into \"C:\\project\\...\" on Windows, so the expected\n\"/project/src/file.ts\" can never match.\n\nHOW TO FIX — the choice matters more than the mechanics:\n- Build expectations with path.join()/resolve() so both sides are OS-native, or compare after\n  normalizing both sides through a single helper. Either keeps the assertion exact.\n- Do NOT switch to substring or regex matching to sidestep separators, and do NOT assert only the\n  basename. These tests exist to prove the exact candidate set, including the src -> tests mirroring at\n  test-runner.ts:127-135; a loose matcher would keep them green while removing that coverage.\n- Prefer one shared normalization helper in the test file over 15 ad-hoc fixes, so a future assertion\n  inherits the correct behaviour.\n\nWORTH DECIDING EXPLICITLY while here: whether findRelevantTests should RETURN posix-style paths.\nIt currently returns OS-native, which is correct for filesystem use, but those values are then passed to\nbuildScopedCommand and end up as CLI arguments to the test runner. Vitest and jest match filename\nfilters against their own forward-slash-normalized paths, so a backslash filter may match nothing.\nThat is a plausible real Windows defect distinct from these test failures — verify it against a real\nscoped run before changing anything, and if it is real, record it as its own item rather than folding\nit into this cleanup."
---
