---
id: "165648b5-2c3b-48b2-8911-fe42059c4381"
type: "task"
title: "Extension environment contract"
slug: "extension-environment-contract"
acceptanceCriteria:
  - "Every extension process (CLI and sidecar) gets the variables in the environment table, and no token value"
  - "`NDX_EXTENSION_STATE_DIR` is created on first run"
  - "`NDX_BIN` re-enters the same n-dx install, tested from a global and a project install"
priority: "high"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "0d02f78e-7d40-4f25-837e-777eecf044fe"
---
