---
id: "b42b3957-511c-42f7-aed8-37980dfe6d13"
type: "task"
title: "Enable Codex hub sessions only after broker-only confinement is proven"
slug: "enable-codex-hub-sessions-only-after"
description: "Remove the intentional Claude-only restriction only after the policy work proves that a Codex hub session cannot read repositories and can act only through the hub broker.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Demonstrate broker-only hub operation with repository reads denied before enabling the Codex vendor selector."
  - "Preserve all operator cards/approvals, hub snapshot/context ceilings, session hosting, ledger, request/token gates and workspace isolation."
  - "Fresh/resumed sessions, Stop/cancellation and restart/recovery retain confinement; connected tools obey hub scope and allow/ask/never policies."
  - "Use disposable negative-read and approval/cancellation fixtures plus supported real-CLI/browser evidence; mark unavailable versions explicitly."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-9"
source: "ndx-capture"
blockedBy:
  - "8d9b361a-d4d1-4e20-a500-b37555d961c5"
---
