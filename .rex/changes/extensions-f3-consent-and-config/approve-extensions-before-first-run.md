---
id: "6ab3826a-a3ed-47aa-a2b5-2fd4896ac98c"
type: "task"
title: "Approve extensions before first run"
slug: "approve-extensions-before-first-run"
acceptanceCriteria:
  - "First run shows package, version, source, commands and sidecar, then asks; non-interactive runs exit 2 naming `ndx extensions enable <name>`"
  - "The approval stores a hash of the manifest block and the version; a change to either asks again"
  - "Project-source approvals are per project path; a freshly cloned repo's extensions never run unapproved"
  - "`enable --yes` approves without a prompt"
priority: "critical"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "0d02f78e-7d40-4f25-837e-777eecf044fe"
---
