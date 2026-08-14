---
id: "b7553a57-22a7-4003-9fbd-ca9cacf1c01a"
level: "task"
title: "Typecheck test files in the web package"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "packages/web/tsconfig.json sets include: [src], so tests/ is outside the typecheck program: test-only type errors and even syntax errors pass pnpm typecheck and only surface at vitest transform time. Add a tests-inclusive typecheck (e.g. tsconfig.test.json referenced by the typecheck script) so test breakage is caught by the same gate as source."
---
