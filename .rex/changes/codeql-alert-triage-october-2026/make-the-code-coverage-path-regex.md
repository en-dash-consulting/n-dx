---
id: "5ce96100-3aa2-49ee-881d-32128dc9cb39"
type: "task"
title: "Make the code-coverage path regex linear and boundary-anchored"
slug: "make-the-code-coverage-path-regex"
description: "Layer 7 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 7). CodeQL alert 19 (js/polynomial-redos) in packages/rex/src/core/code-coverage.ts line 44: the file-path regex scanned over PRD descriptions and criteria is quadratic (800 to 940 ms on 50k characters of dashes or repeated segments). crossReferenceChanges is a public export with no caller in the monorepo and no unit test. Fix: a lookbehind that restricts match starts to token boundaries plus an optional leading slash, with normalizePath stripping a leading ./ or /. Three deliberate behaviour changes, all mid-token false positives the old regex produced: foo.bar/baz.ts no longer yields bar/baz.ts, a GitHub URL no longer yields com/org/repo.git, v1.2/foo.ts no longer yields 2/foo.ts. Its own layer so the delta is reviewable; if the export's semantics must not change, cap the scanned text instead. Branch fix/rex-code-coverage-path-regex."
acceptanceCriteria:
  - "src/foo/bar.ts, ./lib/util.js, a backticked path, a parenthesised path, /abs/path/file.md, @scope/pkg/index.ts and two paths joined by a semicolon extract as before"
  - "extractFilePaths finishes within the callWithinBudget budget on a 100k-character description of dashes"
  - "The three removed mid-token matches are asserted absent and named in the changeset"
  - "Patch changeset for @n-dx/rex"
priority: "medium"
source: "codeql-triage"
---
