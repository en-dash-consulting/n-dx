---
id: "03d9f52f-7ec7-452d-9d62-5c391269c2c5"
type: "change"
title: "Add rollback configuration, confirmation UX, and regression tests"
slug: "add-rollback-configuration"
intent: "Expose rollback behavior as a configurable option in .n-dx.json (hench.rollbackOnFailure, default: true). In interactive mode, prompt the user to confirm before reverting. In non-interactive/CI mode (TTY absent or --yes flag), proceed automatically. Add integration tests covering rollback, --no-rollback suppression, PRD reset, and CI auto-confirm."
acceptanceCriteria:
  - "hench.rollbackOnFailure config key defaults to true and is documented in ndx config --help"
  - "In interactive mode, a confirmation prompt is shown before changes are reverted"
  - "In non-interactive mode (no TTY or --yes flag), rollback proceeds without a prompt"
  - "ndx work --no-rollback overrides config and skips file rollback for a single run"
  - "Integration test verifies uncommitted changes are reverted after a simulated run failure"
  - "Integration test verifies PRD task status is reset to pending after failure"
  - "Integration test verifies --no-rollback leaves files in place while still resetting PRD status"
  - "All new tests pass in CI without requiring a live LLM or git remote"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "medium"
tags:
  - "hench"
  - "config"
  - "ux"
  - "testing"
source: "smart-add"
---
