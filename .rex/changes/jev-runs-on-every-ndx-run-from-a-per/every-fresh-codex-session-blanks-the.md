---
id: "076f5980-a069-4a02-acb0-7d93094c1722"
type: "task"
title: "Every fresh Codex session blanks the agent's key, whatever flags its caller passes"
slug: "every-fresh-codex-session-blanks-the"
description: "#956 review S3. packages/llm-client/src/vendor-session-driver.ts: the resume branch always adds codexShellEnvFlags(), but the fresh branch (:573) adds only input.codex?.policyFlags ?? []. hench and the web sidecar pass compileCodexPolicyFlags(...), which ends with those flags, so neither leaks today; but startVendorSession is public, and a caller passing policyFlags ['-s','read-only'] or no codex block, under llm.codex.auth api, starts codex exec with OPENAI_API_KEY readable by the agent's shell. Always append codexShellEnvFlags() in the fresh branch too; a repeated -c with the same value is harmless."
acceptanceCriteria:
  - "A fresh Codex turn's argv ends its flags with codexShellEnvFlags() for policyFlags absent, ['-s','read-only'], and compileCodexPolicyFlags output (unit test on the driver)"
  - "tests/integration/vendor-session.test.ts expects the overrides on the first turn as well as the resumed one"
priority: "medium"
source: "pr-956-review"
---
