---
id: "0cde8782-b5f0-4202-93ae-044d427184a5"
type: "task"
title: "Requirement coverage counts what rex ready reads"
slug: "requirement-coverage-counts-what-rex"
description: "Stack review round 2 finding on #967 at packages/web/src/server/routes-rex/product.ts:390 (review comment 4494324551).\n\n**Should fix: requirement coverage counts requirements that `rex ready` never reads on v2**\n\n`requirementCoverage` counts automated and metric requirements only on product-layer nodes (`if (root !== \"product\") continue;`). But `rex ready` evaluates `store.loadDocument()`, and on v2 the change-layer store's document never includes the product layer (change-layer-store.ts:11). So the panel is wrong both ways. A project with automated requirements only on capabilities loses the \"why Ready reads 0\" line while nothing turns ready. A project with requirements on changes or tasks is told \"rex ready needs an automated requirement\" while `rex ready` is marking items.\n\nFix: count requirements on the change-layer nodes ready actually evaluates (open changes, tasks, subtasks), or reword the line and row so they don't claim to explain `rex ready`. Update the doc comment and the docs/packages/web.md sentence to match."
acceptanceCriteria:
  - "On v2, requirement coverage counts automated or metric requirements where rex ready evaluates them (open changes, tasks and subtasks), or the line and row are reworded so they do not claim to explain rex ready"
  - "The doc comment in routes-rex/product.ts and docs/packages/web.md match what is counted"
  - "A test covers the v2 counting"
---
