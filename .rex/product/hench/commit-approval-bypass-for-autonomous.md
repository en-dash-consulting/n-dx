---
id: "3ca4d0d8-070b-476f-8c90-79bf6b349021"
type: "capability"
title: "Commit Approval Bypass for Autonomous Runs"
slug: "commit-approval-bypass-for-autonomous"
statement: "When ndx work runs in an autonomous mode (--auto or --loop), it commits with the generated commit message without asking the user for approval, and interactive runs still ask for approval."
criteria: [{"id":"c1","text":"When ndx work runs with --auto, the hench agent shall finish commits using the generated commit message without asking for commit message approval."},{"id":"c2","text":"When ndx work runs with --loop, the hench agent shall finish commits using the generated commit message without asking for commit message approval."},{"id":"c3","text":"When ndx work runs without --auto or --loop, the hench agent shall ask the user to approve the generated commit message before finishing the commit."},{"id":"c4","text":"The hench agent shall decide whether to skip the commit approval prompt from the same flag state that controls its other autonomous behaviours, not from a separate toggle."}]
source: "smart-add"
---

Allow ndx work invocations running in non-interactive autonomous modes (--auto, --loop) to skip the interactive commit message approval gate, so unattended runs don't stall waiting for user input.
