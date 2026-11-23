---
id: "8c849649-b8bf-4533-8a45-840c2e5c2ecf"
type: "task"
title: "Expect the [go-parse] parse-issues line in the Go oversized-file test"
slug: "expect-the-go-parse-parse-issues-line"
summary: "Updates one test so it expects the one-line report of files too large to read fully, which the analyzer now prints."
description: "In packages/sourcevision/tests/integration/imports-go-incremental.test.ts, the test 'keeps the imports of a Go file over the pack's size limit from its import prefix, naming the skipped structure' asserts messages toEqual one line. Since 612011bd3 the imports phase also warns parseIssuesNotice for the Go pack: '[go-parse] 5 files: 1 over 1 MiB not parsed; listed in imports.json summary.parseIssues.'. Update the expectation to include that line, keeping the oversized-file notice as is; and assert imports.json summary.parseIssues.go records the oversized file, if the test can read it cheaply. Do not change pack-imports.ts: the line is intended.\n\nThe Go grammar must be built for this test to run (otherwise skipUnlessPackRuns skips it): run 'pnpm --filter @n-dx/lang-go build:grammars' first if packages/lang-go/build/grammars/tree-sitter-go.wasm is missing. Then run 'SV_REQUIRE_GRAMMARS=1 npx vitest run tests/integration/imports-go-incremental.test.ts' in packages/sourcevision. Search sourcevision's tests for other exact-equality message assertions on Go, Java, Python, Terraform or SQL oversized or syntax-error fixtures and update them the same way only if they fail with grammars built."
acceptanceCriteria:
  - "imports-go-incremental.test.ts passes with the Go grammar built"
  - "pack-imports.ts is unchanged"
priority: "high"
run: {"tier":"light","skipTestGate":true}
---
