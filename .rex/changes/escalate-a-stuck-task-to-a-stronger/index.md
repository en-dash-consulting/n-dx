---
id: "3a148b26-89aa-4d2d-afc8-81d2a0976878"
type: "change"
title: "Escalate a stuck task to a stronger model before skipping it"
slug: "escalate-a-stuck-task-to-a-stronger"
intent: "hench skips a task as stuck after hench.maxFailedAttempts consecutive failures, which only postpones it. With hench.escalation enabled, a task that reaches hench.escalation.after consecutive failures runs its next attempt on hench.escalation.vendor (and optional .model) through the per-task settings resolution; only when hench.escalation.maxAttempts escalated attempts also fail does the existing stuck/skip logic apply. Off by default."
acceptanceCriteria:
  - "hench.escalation.enabled (default false), .after (default 2), .vendor, .model and .maxAttempts (default 1) are validated, documented in ndx config --help and offered by hench config and the dashboard"
  - "When a task reaches the configured consecutive failures with escalation enabled, its next attempt runs on the escalation vendor and model, with one log line naming the task, the reason and the vendor/model"
  - "An explicit CLI model flag and a task's saved run settings keep their precedence"
  - "A task is skipped as stuck only after its escalated attempts also fail; with escalation disabled behaviour is unchanged"
  - "The run record notes that the run was escalated and on which vendor and model, and ndx work --resolve shows it"
touches:
  - "2e136c81-64ea-4b4f-96ad-d070f98665e1"
source: "ndx-capture"
---
