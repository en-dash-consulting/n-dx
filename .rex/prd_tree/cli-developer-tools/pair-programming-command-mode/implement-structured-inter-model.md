---
id: "75c7df48-1438-4a03-8467-34bc0de734ae"
level: "task"
title: "Implement structured inter-model handoff so reviewer findings are fed back to the primary"
status: "completed"
priority: "medium"
tags:
  - "pair-programming"
  - "handoff"
  - "feedback-loop"
source: "smart-add"
startedAt: "2026-04-16T16:56:18.148Z"
completedAt: "2026-04-20T14:00:04.943Z"
resolutionType: "code-change"
resolutionDetail: "Added ReviewFeedback struct, parseReviewerOutput parser, buildRemediationContext builder, runReviewerLlmCapturing (tee to terminal + capture), wired feedback loop into handlePairProgramming with --skip-feedback flag"
acceptanceCriteria:
  - "Reviewer output is parsed into a structured ReviewFeedback object with fields: passed (bool), errors (string[]), suggestedFixes (string[]), testVerdict (passed|failed|skipped)"
  - "When the reviewer finds errors, a second primary invocation is triggered with the reviewer's findings appended as context"
  - "The remediation pass uses the same constraint framing: fix reviewer-identified issues only, no new features"
  - "The feedback loop executes at most once (primary → reviewer → primary-remediation); no further cycles"
  - "The final exit code reflects the outcome of the last reviewer pass, not the primary's initial run"
  - "A --skip-feedback flag disables the feedback loop for faster one-shot use"
description: "After the reviewer LLM runs its validation pass, its findings (errors found, test verdict, suggested micro-fixes) should be captured as a structured artifact and fed back to the primary model as a follow-up turn. This creates the 'bickering pair' dynamic where models actually exchange information: the primary does the work, the reviewer audits it, and if issues remain the primary gets one remediation pass with the reviewer's specific feedback. The loop should be bounded (at most one feedback round) to prevent infinite back-and-forth."
---
