---
id: "1cf2b59c-2568-44d4-a1ca-19cf0d116220"
type: "task"
title: "Make the auth isolation test's secrecy assertions able to fail"
slug: "make-the-auth-isolation-test-s-secrecy"
description: "PR #1003 review comment https://github.com/en-dash-consulting/n-dx/pull/1003#discussion_r4558509250. In packages/web/tests/integration/auth-context-isolation.test.ts the two 'without exposing synthetic key values' assertions cannot fail: runAuthCheck never passes env to exec, and the response body is the mock's stdout."
acceptanceCriteria:
  - "Either the secrecy claim is dropped from the test titles, or the assertions check a surface that could actually leak the key (the verdict state map's key or a logged line) and fail when it does."
priority: "high"
source: "ndx-capture"
---
