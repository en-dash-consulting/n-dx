---
id: "eee22417-50e4-41a3-8749-cd55f3190d8a"
type: "change"
title: "Bypass commit message approval when ndx work runs with --auto or --loop"
slug: "bypass-commit-message-approval-when"
intent: "The hench agent's commit workflow currently prompts the user to approve generated commit messages before finalizing a commit. In autonomous modes (--auto, --loop), there is no interactive user to respond, causing runs to hang or time out. Detect these flags at the point the commit-approval check is invoked and skip the prompt, falling back to the generated commit message without confirmation. Preserve the existing interactive behavior for normal (non-autonomous) runs."
acceptanceCriteria:
  - "ndx work --auto completes commits without prompting for commit message approval"
  - "ndx work --loop completes commits without prompting for commit message approval"
  - "ndx work (no auto/loop flags) still prompts for commit message approval as before"
  - "The bypass is driven by the same flag state that governs other autonomous behaviors, not a separate toggle"
  - "Unit or integration test covers both the bypass and the interactive path"
touches:
  - "3ca4d0d8-070b-476f-8c90-79bf6b349021"
priority: "high"
tags:
  - "hench"
  - "agent"
  - "cli"
source: "smart-add"
---
