---
id: "6383a949-3657-4802-ad9d-c90885b2f546"
type: "change"
title: "Sidecar status cards permit subtree deletion and conceal completion apply effects"
slug: "sidecar-status-cards-permit-subtree"
intent: "Finding 3, PR #998; packages/web/src/server/sidecar/status-card.ts:29,71 and viewer/components/sidecar-status.ts. PROPOSABLE_STATUSES and the broker schema include deleted. Approving an ordinary status card for a change calls rex's deletion path and removes its whole subtree while the UI says \"Status written.\" A real fixture removed a change plus its task (removedCount:2). Completing the last task of a pending change with default rex.applyOn=complete also changed product requirements and applied the change while the card described only a status write. Both were prior review concerns that remain in the reviewed head. Recommend removing deleted from the ordinary status proposal/schema and clearly previewing/disclosing enclosing-change completion and product-apply consequences before approval. Do not disable rex's legitimate completion policy silently. A dedicated deletion card with subtree preview is a separate product option, not required for this fix. Evidence: /private/tmp/ndx-review-repro.mjs and .log.\n\nOwning PR: https://github.com/en-dash-consulting/n-dx/pull/998\nReviewed head: 15d6fe908789736a78533f4166b732fea337ce5b\n\nApproved by Ryan on 2026-11-09 after the nine-PR stack review. This is remediation, not permission to merge, publish, restack, or change unrelated code. Execute only in a dedicated worktree based on the owning PR head; the coordination branch contains capture metadata only. One item per ndx work execution. Use Codex CLI and Codex self-review, never fall back to Claude; keep the affected test gate enabled. The coordinator integrates fixes into the owning PR and performs one bottom-up restack after remediation; individual workers must not restack or force-push the stack."
acceptanceCriteria:
  - "propose_status rejects deleted before raising a normal status card; broker input schema and server validation agree; existing PRD nodes and children remain unchanged."
  - "A v2 completion card states when completing the item may complete its enclosing change and apply product amendments, before the operator approves."
  - "Completion still follows rex's own transition/claim/test-gate-hold/apply policy, and held completions remain labeled held rather than written."
  - "Tests cover a change with children, a pending change's last task with auto-apply, and a completion with no apply effect; scoped tests and required root checks pass; add scoped patch changesets."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "d3bfe8a4-c3d5-4aa4-893b-36fc58647dca"
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"skipTestGate":false}
tags:
  - "pr-stack-review"
  - "codex-remediation"
  - "finding-3"
  - "pr-998"
source: "ndx-adversarial-review"
---
