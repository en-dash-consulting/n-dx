---
id: "bfee741f-343a-4a2c-b12f-50aa262811ef"
type: "task"
title: "ndx config credentials --import replaces a vendor's helper entry with the plaintext file key"
slug: "ndx-config-credentials-import-replaces"
description: "Verdict: should-fix (ndx-adversarial-review of C2b). Scenario: the user stored `ndx config credentials.claude --helper \"op read …\"`, and .n-dx.local.json still holds an old llm.claude.api_key. Running `ndx config credentials --import` (or answering y on a TTY) runs `credentials set claude`, which overwrites the helper entry with the file's plaintext value. The password-manager setup is silently lost, and the key now sits as plaintext in credentials.json. Location: packages/core/config.js importLocalApiKeys. It is reachable through the documented --import flow. Options: (A, recommended) skip a vendor whose store entry is a helper, keep the file key, and print a line telling the user to remove it by hand; this costs one status lookup. (B) Ask before replacing any existing store entry; this needs prompt plumbing for the non-TTY --import path."
acceptanceCriteria:
  - "With a helper stored for claude and a claude api_key in .n-dx.local.json, `ndx config credentials --import` leaves the helper entry in credentials.json unchanged (e2e)"
  - "The command prints one line naming the skipped vendor and the file that still holds the key, never the value"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
