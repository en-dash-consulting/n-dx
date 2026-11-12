---
id: "b2d58519-a069-4b03-9aef-3cc5753b1055"
type: "task"
title: "Integrate Ready-to-run queue with summaries and one-click controls"
slug: "integrate-ready-to-run-queue-with"
summary: "Keep the complete filtered task list while retaining readable summaries and the newer Start controls."
description: "Approved Wave1 integration task for PR #1000. During bottom-up restack retain original commits and resolve conflicts by combining behaviors, not choosing a side wholesale. Preserve stack's 10 collapsed rows (Ryan's explicit choice), Show all, complete one-request loading/search/filters/change identity/total, and main summary/displayTitle/technical tooltip/ImpactTags/useItemImpacts. Retain main shared run-settings structure and one-click/arrow behavior. Manual rebase conflict resolution is authorized; any new code/test repairs and completion verification go through actual ndx work. Add meaningful regression coverage combining both original test sets and realistic route replies; do not invent no-op source changes. Keep finding6 inherited-priority fix deferred and separate. Requires finding3 integrated in updated parent before execution; coordinator wires its dependency when the record is present."
acceptanceCriteria:
  - "Ready API retains v2 selector, paging/all=1/total/change identity and main summaries, with v1 behavior preserved."
  - "Ready viewer shows 10 initial rows and Show all over the complete loaded queue, with search/filters, summary-first titles/technical tooltips and impact tags."
  - "Retain one-click Start, direct arrow-to-settings, defaults/saved settings, queue/refusal/errors and workspace behavior; retain both main and stack regression coverage."
  - "Pass scoped web checks, required cli-dev and scheduler-startup tests, mandatory Codex self-review and enabled affected gate; scoped patch changeset and atomic task completion commit with item trailer."
priority: "high"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false}
tags:
  - "wave-1-integration"
  - "approved"
  - "pr-1000"
source: "ndx-capture"
blockedBy:
  - "6383a949-3657-4802-ad9d-c90885b2f546"
---
