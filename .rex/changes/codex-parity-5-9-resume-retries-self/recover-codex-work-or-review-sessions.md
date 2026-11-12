---
id: "67ba89bb-f9b8-43b6-94da-22571a781d0d"
type: "task"
title: "Recover Codex work or review sessions that ended unfinished"
slug: "recover-codex-work-or-review-sessions"
description: "An unfinished work session or reviewer that stopped without its required report needs a bounded continuation; do not treat a missing report as a successful review or parse arbitrary shell ampersands as proof.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Supported unfinished-work/review signals receive one bounded continuation of the correct session."
  - "Missing review reports cannot masquerade as successful review; failed continuation yields an actionable failure."
  - "Recovery never repeats already completed task mutations or commits, widens policy or bypasses the test/review gate."
  - "Cover work, reviewer, interruption/cancellation and repeat-wait failure cases with disposable fixtures and supported-CLI evidence."
priority: "medium"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-5"
source: "ndx-capture"
blockedBy:
  - "5ee99eba-3cf2-4e55-bfdb-790ec442e22c"
---
