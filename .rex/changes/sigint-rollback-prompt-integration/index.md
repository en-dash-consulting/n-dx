---
id: "75fa50be-c4f3-47aa-a1af-3a4af939f891"
type: "change"
title: "SIGINT rollback-prompt integration tests are flaky and leak Windows handles"
slug: "sigint-rollback-prompt-integration"
intent: "Windows CLI Smoke run 34734219781 failed two cases in packages/hench/tests/integration/sigint-prompt.test.ts: the fake readline prompt array remained empty after the two-second wait in the second-Ctrl-C and readline-SIGINT cases. Failed cleanup then reported EBUSY while removing the temporary project directories. The immediately prior Windows run passed all six tests and no Hench source changed between runs, so this is a timing/global-handle test flake. Make prompt readiness deterministic and ensure all readline, SIGINT, git-child, and temp-directory resources are settled before cleanup, while preserving coverage of process-level and readline-delivered Ctrl-C behavior."
acceptanceCriteria:
  - "The second-Ctrl-C and readline-SIGINT rollback-prompt cases wait on an observable prompt-ready condition rather than a fixed timing window."
  - "Each test restores SIGINT listeners and closes readline resources before temporary-project cleanup, including when an assertion fails."
  - "The focused sigint-prompt integration suite passes repeatedly on Windows without EBUSY cleanup errors."
  - "The full Windows CLI Smoke job passes without skipping the affected cases."
touches:
  - "a63d1345-5167-4332-844a-0398aea517b1"
priority: "high"
tags:
  - "windows"
  - "hench"
  - "ci-smoke"
source: "ndx-capture"
---
