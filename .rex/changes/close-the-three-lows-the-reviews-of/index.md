---
id: "2ec844dd-e1ff-4e41-9518-35262f18f2f7"
type: "change"
title: "Close the three lows the reviews of 181fe90f and 0c2bed4d dropped: copy lines, an arrow in a rename source, review-flag ordering test"
slug: "close-the-three-lows-the-reviews-of"
intent: "Three low findings the Opus reviews of 181fe90f (run review b2a1ef06) and 0c2bed4d (review 67c4bfd4) dropped as not worth fixing. Ryan asked to fix them in PR #1004 (2026-11-06).\n\n1. Copy lines (packages/hench/src/store/artifacts.ts matchesPorcelainLine, ~308). Since 181fe90f, an R or C porcelain line is discounted only when both source and target match. That is right for a rename (the source left the tree), but a copy (C) leaves its source in place, so only the target needs to match. Today, with status.renames=copies, `C  src/app.ts -> .rex/changes/x/app.md` is not discounted and the between-task guard refuses. Fix: require the source to match only for R lines; a C line matches on its target alone. partitionDirtyPaths follows from the same helper, so a copy from src/ into .rex/ files under prd. Keep a rename from src/ into .rex/ undiscounted and filed under other.\n\n2. Rename source with \" -> \" in its name (packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts reportedPath, ~330). reportedPath re-splits formatPorcelainPath(line) on the first \" -> \", so a rename from `src/a -> b.ts` into .rex/ is reported as `src/a`. splitPorcelainPaths already splits on the last \" -> \" and gets the source right. Fix: take the source from splitPorcelainPaths (export a small helper from store/artifacts.ts, e.g. porcelainSourcePath, rather than re-splitting the display string).\n\n3. Review-flag ordering test (packages/hench/tests/e2e/run-flag-conflicts.test.ts). 0c2bed4d moved parseReviewOptions into validateRunFlags ahead of assertPrdFolderExists, but only the --epic-by-epic --epic refusal has a test on an init-only project. Add one case on the same init-only tmpDir for a review-flag refusal (`--review --no-review`, message \"--review and --no-review were both passed\") asserting exit 1, that message, and no \"No PRD folder\".\n\nOperator notes: run the six static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code); add one @n-dx/hench patch changeset."
acceptanceCriteria:
  - "With matchesPorcelainLine and PRD_COMMIT_PATHS, a staged copy line `C  src/app.ts -> .rex/changes/x/app.md` is discounted, and a rename `R  src/app.ts -> .rex/changes/x/app.ts` is not (hench unit test)"
  - "partitionDirtyPaths files a copy from src/ into .rex/ under prd and a rename from src/ into .rex/ under other (hench unit test)"
  - "findUncommittedWork names `src/a -> b.ts` in full for a staged rename from that path into .rex/ (hench unit test)"
  - "`hench run --review --no-review <dir>` on a hench-init-only project exits 1 with \"--review and --no-review were both passed\" and no \"No PRD folder\" (run-flag-conflicts e2e test)"
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-adversarial-review"
---
