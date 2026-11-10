---
id: "68b2709d-174e-4ec2-bf3f-163fdda6115c"
type: "task"
title: "C10: OS keystore backends (macOS Keychain, Windows DPAPI, Linux libsecret)"
slug: "c10-os-keystore-backends-macos"
description: "Phase 2, deferred (design D5). Opt-in os backend with no native module."
acceptanceCriteria:
  - "An opt-in os backend stores and reads on macOS, Windows and Linux with libsecret, and refuses with a suggestion of file where libsecret is absent"
priority: "low"
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
