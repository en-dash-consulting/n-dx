---
id: "1f337244-a220-4868-a189-ea13471c0603"
type: "change"
title: "Wave 1 integration: preserve queue and execution behavior on current main"
slug: "wave-1-integration-preserve-queue-and"
summary: "Bring the existing dashboard stack up to date while keeping its complete task list and the newer summaries and Start controls."
intent: "Approved by Ryan in this chat on 2026-11-11: capture two integration tasks for Wave 1 PRs #998,#1000,#1002,#1003,#1004,#1006,#1008. Preserve original own-commit history during bottom-up restack; manual conflict resolution is allowed by the supplied runbook, and new semantic code/test repairs execute through actual ndx work. User explicitly selected the stack's 10 collapsed Ready-to-run rows with Show all, search and filters; retain main's summaries and impact tags and #1012 one-click Start. Finding 3, finding 8 and finding 2 remain their existing separate records. Finding6 is deliberately deferred, Wave2 and paused follow-ups are excluded. Latest authority: atomic leased force-push, CI label/ready and PR status comments allowed, ALL PR MERGES PROHIBITED. After Wave1 is fully updated/validated, parity root #1029 may be stacked above #1008 and approved parity tasks may begin; do not require merging Wave1 into main. Never touch dirty original checkout/shared config/other lane worktrees. At most two ndx work runs or gates across vendors. Use independent clones, checkout-local Codex routing, scoped patch changesets, nonoptional self-review, enabled gate, atomic source+PRD task commits and bare final N-DX-Item trailers. Rebuild after restack; preserve raw v2 identity/state; regenerate prompt baselines from a clean committed source tree. Runbook: /Users/ryankeith/ndx-core/local-design-workshop/docs/roadmap/sidecar-hub-2026-11-06/wave-1-landing-runbook.md, with latest human no-merge/parity-on-stack correction taking precedence."
acceptanceCriteria:
  - "Ready-to-run preserves all actionable work, one-request complete loading, total/search/filters and 10 initially shown rows with Show all, while retaining summary-first titles, technical tooltips and impact tags."
  - "One-click Start and the arrow's Prepare settings flow retain project/saved defaults, version/refusal/workspace behavior, and task-less v2 changes use the shared transactional eligibility and save path."
  - "Both integration tasks pass meaningful regression coverage, scoped checks, required startup tests, mandatory Codex self-review and enabled affected gates with scoped patch changesets and atomic code/PRD commits."
  - "Raw v2 identities and completed/moved records reconcile without duplicates or lost state, prompt baselines are regenerated rather than hand-merged, and all authority/scope boundaries remain enforced."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
tags:
  - "wave-1-integration"
  - "approved"
  - "codex-remediation"
source: "ndx-capture"
---
