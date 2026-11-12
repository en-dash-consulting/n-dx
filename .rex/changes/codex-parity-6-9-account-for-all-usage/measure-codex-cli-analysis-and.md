---
id: "6ea1141c-9080-44a8-8442-1d67846b8de0"
type: "task"
title: "Measure Codex CLI analysis and planning token usage"
slug: "measure-codex-cli-analysis-and"
description: "Use structured CLI usage without losing the final text consumed by rex/sourcevision. The audit fake CLI emitted turn.completed usage but createCodexCliClient returned only text.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Consume structured CLI usage while retaining the exact text result for analysis/plan callers."
  - "Preserve cached/uncached distinctions and prevent double counting replayed or cumulative counters."
  - "Unavailable or malformed usage is explicitly distinguishable from measured zero; retries and failures do not erase measured spend."
  - "Rex/sourcevision ledgers, dashboard rollups and budget consumers receive measured usage; include fake-binary and real supported-CLI evidence."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "a1e20ed5-e3cd-489e-8978-5bd2f46a52ea"
---
