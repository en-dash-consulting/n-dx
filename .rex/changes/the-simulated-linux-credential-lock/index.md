---
id: "ab0e5e80-aca6-47e0-a80e-1aae3578d655"
type: "change"
title: "The simulated-Linux credential lock test skips on a Windows host"
slug: "the-simulated-linux-credential-lock"
intent: "Follow-up to 8dd961e5 (#999), found by PR #1005's Windows CI job (run 42322014404): packages/llm-client/tests/unit/credential-store.test.ts > 'Windows delete-pending lock files' > 'on linux, a temp file that will not go after the link still lets the writer hold, write and release the lock' fails with 'expected undefined to be placeholder-file-key'. The test is parameterised over host win32 and linux (around line 652) and passes platform: 'linux' while running on a Windows runner. With platform linux, resolveCredential refuses a store whose mode has group or other bits (packages/llm-client/src/credential-store.ts:287, mode & 0o077); real Windows files report mode 0o666, so the read returns undefined. The lock fix is not at fault. Skip the linux variant on a Windows host (the file already has isWindows and uses describe.skipIf(isWindows) for its POSIX permissions block): it.skipIf(host === 'linux' && isWindows). Change nothing else, add no changeset (test-only). Run the credential-store unit tests."
acceptanceCriteria:
  - "The linux variant is skipped on a Windows host and runs elsewhere; the credential-store unit tests pass"
touches:
  - "a63d1345-5167-4332-844a-0398aea517b1"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
