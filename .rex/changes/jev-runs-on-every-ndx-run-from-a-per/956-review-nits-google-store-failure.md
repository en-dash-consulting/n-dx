---
id: "7b397157-7309-4db5-913e-ac86d57f7f67"
type: "task"
title: "#956 review nits: Google store failure page, scrub warning, Windows spawn error, non-terminal --import, replace-path test"
slug: "956-review-nits-google-store-failure"
description: "#956 review nits (issue comment 6672622190). (1) packages/web/src/landing/landing.ts:243: after a failed Google key store the submit button stays disabled and spinning, because the credentialWarning branch returns without setBusy(false). (2) packages/llm-client/src/child-env.ts: the Claude subprocess-scrub warning names allowlisted GITHUB_TOKEN/GH_TOKEN as hidden, but Claude Code documents the scrub as leaving GitHub tokens in place, and the warning is not gated on the vendor being Claude. (3) packages/core/config.js ~4172: spawnCredentialsCli's spawnSyncCli call lost the old try/catch, so on Windows a %NAME% path that assertNoWindowsEnvExpansion refuses surfaces as a stack trace instead of one line. (4) Without a terminal, ndx config credentials --import leaves a vendor whose stored key differs in place and still exits 0. (5) Nothing tests the terminal 'yes, replace' answer to the fingerprint confirmation (config.js:4497)."
acceptanceCriteria:
  - "After a failed Google key store the landing page re-enables its submit button and shows the warning (unit test)"
  - "The scrub warning is shown only for Claude and does not name GitHub tokens as hidden (unit test)"
  - "A refused Windows path in spawnCredentialsCli prints one error line, no stack (unit test with an injected platform or spawn)"
  - "Non-terminal --import that leaves a differing key in place exits non-zero and names the vendor (e2e)"
  - "The terminal 'y' answer replaces the stored key with the file's and removes it from the file (e2e through a pseudo-terminal or an injected answer)"
priority: "low"
source: "pr-956-review"
---
