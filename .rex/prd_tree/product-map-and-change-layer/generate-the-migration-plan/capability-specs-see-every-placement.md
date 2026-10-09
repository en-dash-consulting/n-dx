---
id: "af0c5e39-33e4-4050-bbf9-11aca16bdc96"
level: "task"
title: "Capability specs see every placement, including the text and Jev passes'"
status: "in_progress"
priority: "high"
blockedBy:
  - "aee05753-ec4b-4a92-bb40-083ad9eb91d5"
  - "2456dcf1-ee91-4263-905d-be002e4d6159"
source: "review"
startedAt: "2026-10-09T03:28:38.458Z"
acceptanceCriteria:
  - "An applied change placed on capability X by the text pass is in X's spec sources and in X's spec question (test)"
  - "An applied change placed on X by the Jev pass is in X's spec sources and spec question, with models \"jev\" and with models \"both\" (test)"
  - "A model spec criterion citing such a change is accepted (test)"
  - "A re-run with unchanged inputs makes no model calls (test)"
description: "From the hub review of #616 at 5814234b3 (migrations/v1-to-v2/capability-spec.ts:343; draftCapabilitySpecs runs inside rules()). Spec sources come from rules-stage placements only. Applied changes that the text or Jev pass places on a capability never reach its spec, and a model criterion citing them is rejected as outside the sources. With models \"jev\" or \"both\", placement settles in the Jev pass, after the text pass has already drafted specs.\n\nDecision D2 (Ryan, 2026-10-08), option A: draft specs after all placement settles. Model work runs in ordered stages: rules, then text placement, then Jev placement, then text spec, then Jev review. Each stage's questions are computed from the entries as merged by the earlier stages. Keep one recorded-answers map per model and the rule that an unchanged question reuses its recorded answer.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T03:28:39.228Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
