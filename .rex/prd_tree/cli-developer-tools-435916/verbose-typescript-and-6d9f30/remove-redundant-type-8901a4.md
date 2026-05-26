---
id: "8901a498-2b15-448a-8fc8-d418b767d220"
level: "task"
title: "Remove redundant type assertions and unnecessary intermediate variables in production TypeScript"
status: "pending"
priority: "low"
tags:
  - "typescript"
  - "refactor"
  - "simplification"
source: "smart-add"
acceptanceCriteria:
  - "No `as X` type assertion exists where the assigned value's type is already narrowed by control flow to match X"
  - "No local variable is declared and then used exactly once on the next statement with no intervening logic"
  - "pnpm typecheck and pnpm build complete with zero new TypeScript errors"
  - "pnpm test passes after the sweep"
  - "Net line reduction is at least 60 lines"
description: "Scan production TypeScript files for `as X` assertions where TypeScript's control-flow narrowing already proves the type, and for local variables declared solely to hold a value used exactly once on the immediately following line. Remove each confirmed redundant assertion and inline each single-use intermediate variable. Verify TypeScript compilation and the full test suite pass after the sweep."
---
