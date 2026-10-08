---
id: "dd0b540e-7b34-44d3-ac8e-299c4b9391b8"
level: "task"
title: "Tighten placement: an explicit code-health marker, title-led relations, and proposals for unmatched changes"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Three fixes from the review of 2fa34877 (run db35fba1), decided 2026-10-08 (Ryan). Do all three; each has its own capture, closed by this run.\n\n1. Code-health marker (capture d0e81205). Placement treats every change with source sourcevision as a code-health finding, so ordinary feature proposals from rex analyze become touches and are boosted toward the architecture constraint. Stop reading source: a change is a code-health finding only when it carries the tag code-health. (Writing that tag when recommend or analyze create finding-derived changes is captured separately under Recommendations become changes.)\n2. Relation from the title (capture 4d097853). Free-text intent flips the relation to amends (an intent mentioning a new store layout on a rename task). Decide amends only from an imperative leading verb in the title that asks for new or changed behaviour, plus an explicit marker in the intent; otherwise touches. fix: true still defaults to touches.\n3. Proposals for unmatched changes (capture 09f9a1df). When the rules shortlist is empty, still ask the text model (if one is configured) for a new-capability proposal, passing the list of areas in the seam input; drop a proposal whose under is not a known area id. A proposal is never auto-accepted. This costs one model call per unmatched change; Ryan accepted that.\n\nTests for each point with mocked model and Jev seams. Stay in core/placement.ts, core/placement-policy.ts and their tests."
lastModified: "2026-10-08T04:53:49.360Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
