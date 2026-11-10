---
id: "e66d734c-3552-4d0d-84eb-6c222c600d19"
type: "task"
title: "The Describe lens gives tightened done-when as text instead of a duplicating change set"
slug: "the-describe-lens-gives-tightened-done"
description: "#906 F2 (medium, must-fix). DESCRIBE_INSTRUCTIONS (lens-instructions.ts) tells the agent to send tightened done-when checks through propose_prd_change, but that tool only adds items. On v2, resolveV2 requires item 1 to be a new change and approval writes a new Inbox change plus a copy of the task; on v1, writeV1 gives every item a fresh id. Either way the task keeps its vague criteria, ndx work still reads them, and the PRD gains a near-duplicate. propose_prd_change has no target-item field and propose_edit is carried out later.\n\nDecided: option 1. Until an edit card exists, the agent quotes each vague check and gives the tightened wording in its reply, and says the operator applies it with rex update or the item editor.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #906."
acceptanceCriteria:
  - "DESCRIBE_INSTRUCTIONS tells the agent to quote each vague check and give the tightened wording in its reply, and to say the operator applies it with rex update or the item editor"
  - "DESCRIBE_INSTRUCTIONS says not to call propose_prd_change for an existing task"
  - "The lens-instructions snapshot or test is updated to match"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#906-F2"
source: "ndx-adversarial-review"
---
