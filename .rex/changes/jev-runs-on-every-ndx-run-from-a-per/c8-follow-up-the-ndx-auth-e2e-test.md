---
id: "0f3163d9-7548-4ff5-abfa-d62d7640c42f"
type: "task"
title: "C8 follow-up: the ndx auth e2e test expects the old Google env-var hint"
slug: "c8-follow-up-the-ndx-auth-e2e-test"
description: "C8 (f912174e, commits cfdc67c6c and 1dcedacaf) changed the Google preflight hint from 'export GEMINI_API_KEY=<KEY>' to 'Or set the env var: export GEMINI_API_KEY', so no message shows a key value. tests/e2e/cli-auth.test.js:185, in 'ndx auth does not send the variable an untrusted repository names', still expects 'export GEMINI_API_KEY=' and fails C8's test gate. Change only that test: assert the new text, and assert stderr does not contain SENTINEL_VAR, which is the test's point (the untrusted repository's apiKeyEnv is never named or used). Do not change the message or any source file."
acceptanceCriteria:
  - "tests/e2e/cli-auth.test.js asserts 'export GEMINI_API_KEY' and that stderr does not contain SENTINEL_VAR, and the whole file passes"
  - "No source file changes; tests/e2e/key-argv-message-policy.test.js still passes"
priority: "medium"
source: "credential-injection-design"
---
