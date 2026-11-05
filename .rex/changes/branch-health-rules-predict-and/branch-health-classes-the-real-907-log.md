---
id: "87d74c1d-2684-4abc-b1ee-440637a1b751"
type: "task"
title: "Branch health classes the real #907 log correctly: failing-only policy tests, caret colour codes, vitest project labels, and a cached PR base"
slug: "branch-health-classes-the-real-907-log"
description: "Found by re-testing branch health after 26754ed7 against PR #907's real failing check, \"Tests (Windows, root+llm-client)\" (gh run view --log-failed, 1,486 lines). The check failed in llm-client's tests/integration/vendor-session.test.ts and the PR is BEHIND with two uncontained stack layers, but it is now classed policy-test, \"The policy suite architecture-policy.test.js failed\". Three defects:\n1. POLICY_TEST matches any mention of a policy test file. The log names architecture-policy.test.js on passing lines (\"✓ tests/e2e/architecture-policy.test.js\"); only a failing one counts.\n2. gh writes colour codes as literal caret text, not ESC bytes: the log has 1,314 \"^[[\" sequences and no 0x1b byte, so cleanLog strips none. The real FAIL line reads: ^[[41m^[[1m FAIL ^[[22m^[[49m ^[[30m^[[42m llm-client:shared ^[[49m^[[39m tests/integration/vendor-session.test.ts^[[2m > ^[[22mclaude sessions. Once cleaned, a vitest project label (\"llm-client:shared\") sits between FAIL and the path, which FAILED_TEST_FILE does not allow. The \"❯ tests/integration/vendor-session.test.ts:134:20\" line has no colour codes.\n3. With GitHub deferred to expansion, a stacked branch's collapsed strip compares against origin's default branch (R1 showed ↑130 ↓97 origin/main, while its PR base is feat/sidecar-m3-lenses with ↑25 ↓0) and its stack is empty, with nothing saying the PR base was not read."
acceptanceCriteria:
  - "policy-test fires only when a policy test file is among the log's failing test files; a log that names architecture-policy.test.js only on a passing ✓ line is not policy-test (tested)"
  - "cleanLog strips colour codes written as literal caret text (^[[41m) as well as ESC bytes; a fixture with the FAIL line quoted in this task's description yields no ^[ in the stored tail and finds the failing file"
  - "FAILED_TEST_FILE accepts an optional vitest project label between FAIL and the path (FAIL llm-client:shared tests/x.test.ts > suite), tested"
  - "A fixture built from this task's description (the FAIL line, the ❯ line, passing policy-test lines, a BEHIND PR with an uncontained layer, an unchanged failing file) is classed behind-base"
  - "After a GitHub read, local-only answers for that worktree and branch reuse the PR base it found (baseSource pr-cached, in server memory); before one, a default base with GitHub reads on says the PR base is not read yet"
priority: "high"
---
