---
id: "a913d67e-2106-45d8-9bef-76991a30c1f7"
type: "task"
title: "classify: results kept from earlier slices when a later split Jev request fails have no test"
slug: "classify-results-kept-from-earlier"
summary: "When a large classification request is split and a later piece fails, the files already answered keep their result. Nothing tests that, so a later edit could silently discard them."
description: "Verdict: should-fix (severity low). Found by adversarial review of 18553ccf6.\n\nScenario: `classifyBatchWithJev` (packages/sourcevision/src/analyzers/classify.ts, the `return merged` after the catch) is asked about 4 files; the first request is refused with max_tokens_exceeded, the first half (2 files) is answered, the second half fails with a rate-limit ClaudeClientError. By design the two answered files are returned. No test covers this: replacing `return merged` with `return null` in the non-auth failure path keeps every test in tests/unit/analyzers/classify.test.ts green while the two answered files are silently left unclassified.\n\nReachable: `ndx analyze` with code.classify routed to TypeSafe, on a batch that needed splitting, when a later slice hits a rate limit, 5xx or timeout after askJev's own retries.\n\nSolution (recommended): one unit test in the \"Jev route\" describe: mock askJev to refuse >2 files as too large, answer the first half, reject the second with ClaudeClientError(\"rate limited\",\"rate-limit\",true); expect updatedFiles to hold the first half and the \"Jev request failed (rate-limit)\" warning once. Cost: ~20 test lines, no source change. Optional while there: an auth error in a later slice currently returns \"auth-error\" and drops the earlier slices' results; decide whether that is wanted and assert it either way."
acceptanceCriteria:
  - "A unit test in packages/sourcevision/tests/unit/analyzers/classify.test.ts splits a batch, fails a later slice with a non-auth ClaudeClientError, and asserts the earlier slices' files are in updatedFiles"
  - "That test fails when classifyBatchWithJev returns null instead of the merged results on the non-auth failure path"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
