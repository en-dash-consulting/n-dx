---
id: "20bbb688-65c2-4331-a508-5b5700272200"
type: "change"
title: "Add integration tests for Ctrl-C interrupt and rollback prompt interaction"
slug: "add-integration-tests-for-ctrl-c"
intent: "The interrupt-to-rollback path currently has no automated coverage. Add integration tests that simulate a SIGINT mid-run, verify the rollback prompt is displayed, and assert correct behavior for both 'confirm' and 'skip' responses. Cover the edge case where a second SIGINT arrives while the prompt is open."
acceptanceCriteria:
  - "Test confirms that after SIGINT the rollback prompt is presented when dirty files exist"
  - "Test confirms that responding 'y' causes revertChanges to be called"
  - "Test confirms that responding 'n' leaves files in place and exits without error"
  - "Test confirms that a second SIGINT during the prompt does not call process.exit(1) and allows the readline to complete"
  - "Tests run in CI without requiring a real TTY (use isTTY mocking or pipe-mode)"
amends: [{"target":"469c7900-cd34-4919-bc40-5f474a96654a","delta":"modified","summary":"Add integration tests for Ctrl-C interrupt and rollback prompt interaction","base":"f9f49c0cdb315850cd86f32a241dfa4d564bcd88e5153f02ab7c4cf8422b9611"}]
priority: "medium"
tags:
  - "hench"
  - "testing"
  - "signal-handling"
source: "smart-add"
---
