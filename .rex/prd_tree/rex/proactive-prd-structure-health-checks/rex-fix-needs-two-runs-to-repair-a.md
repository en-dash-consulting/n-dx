---
id: "bd8aafde-9826-4b33-9230-fa7f10155f0c"
level: "task"
title: "rex fix needs two runs to repair a misalignment nested under another completed parent"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A single `rex fix` run on epic(completed) > feature(completed) > task(pending) leaves both the epic and the feature pending"
  - "detectIssues on that tree reports parent_child_alignment for BOTH the epic and the feature, so the dry-run plan matches the single-run outcome"
  - "A unit test in packages/rex/tests/unit/fix/index.test.ts asserts a second detectIssues call on the repaired tree returns an empty array"
description: "Severity: medium. Verdict: out-of-scope — pre-existing, not introduced by the reopen/stuck-parent change, but confirmed while reviewing it.\n\nFAILURE SCENARIO. Tree: epic E completed > feature F completed > task T pending. applyParentChildFixes (packages/rex/src/fix/index.ts) computes findMisalignedParents ONCE and iterates that snapshot. Pass 1 sees only F as misaligned (E's only child F still reads completed), reopens F to pending, and reports 'Fixed 1 issue'. E is now completed with a pending child — the exact inconsistency rex validate warns about — and rex fix has just claimed success. A second rex fix run is required to reopen E; a third to confirm clean. Verified against the built dist: pass 1 parent_child_alignment/f1, pass 2 parent_child_alignment/e1, pass 3 clean.\n\nPRE-EXISTING. The old code had the identical shape: it set F to in_progress, which was likewise not in its terminal set, so E was flagged only on the next run. The reopen-to-pending change altered which status F lands in, not the convergence behaviour.\n\nREACHABILITY. `rex fix` / `ndx fix` on any PRD where a falsely-completed parent sits under another completed parent. Common after an interrupted run.\n\nSOLUTIONS.\n1. (recommended) Iterate the reopen to a fixpoint: walk misaligned parents bottom-up rather than in pre-order walkFixTree order, so reopening F is visible when E is evaluated. A single post-order pass is sufficient — collectFixTreePostOrder already exists in packages/rex/src/fix/tree.ts. Cost: small. Risk: the reported plan must be recomputed the same way or detect/apply diverge again, which is exactly the defect the adversarial review of this change fixed — reuse the willReopen mechanism in findStuckParents rather than inventing a second one.\n2. Loop applyFixes until mutatedCount is 0, capped at a small number of passes. Simpler, but reports each pass separately and makes the action list harder to read.\n3. Leave it and document that rex fix should be run until it reports clean. Cheapest, but the tool currently gives no indication that a second run is needed."
lastModified: "2026-09-12T09:10:25.630Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
