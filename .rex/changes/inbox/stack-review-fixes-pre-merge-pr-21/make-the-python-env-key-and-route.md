---
id: "aab7b3ff-a8e8-4c1d-927e-467c54139571"
type: "task"
title: "Make the Python env-key and route-prefix helpers linear on any input"
slug: "make-the-python-env-key-and-route"
description: "**should-fix (CodeQL js/polynomial-redos on #796).** Alerts: https://github.com/en-dash-consulting/n-dx/pull/796 (python-clients.ts lines 161 and 163, python-web.ts line 408 at that PR).\n\nAt the PR 21 tip:\n- `packages/lang-python/src/python-clients.ts:161,163`, `envKey`: `/^([A-Za-z_][\\w.\\s]*?)\\s*\\[([\\s\\S]*)\\]$/` and the `(`…`)` twin. The lazy `[\\w.\\s]*?` overlaps the following `\\s*`, so a name followed by many spaces and no bracket is quadratic (40,000 spaces take about 0.9 s per regex).\n- `packages/lang-python/src/python-web.ts:449`, `joinPrefix`: `prefix.replace(/\\/+$/, \"\")` is quadratic on many `/` followed by another character.\n\nFix, keeping results identical: in `envKey`, find the first `[` (or `(`), require the text to end with `]` (or `)`), take the name as the text before it with trailing whitespace trimmed, and check the name with one linear test (`/^[A-Za-z_][\\w.\\s]*$/`); the lazy regex matched exactly that split, since the name class excludes brackets. In `joinPrefix`, trim trailing `/` with a loop. Tests under `callWithinBudget` (packages/lang-kit/tests/helpers/call-within-budget.ts, from the #825 hardening; it is a lang-kit test helper, so reuse it the way that package's test conventions allow, or add the same worker-with-a-budget helper to this package's tests) on the adversarial inputs, plus equivalence cases (`os.environ[\"X\"]`, `os.environ .get ( \"X\" )`, `os . getenv(\"X\")`, non-literal keys, unbalanced text). Add a `@n-dx/lang-python` patch changeset."
acceptanceCriteria:
  - "envKey and joinPrefix return the same results as before for every existing test and the new equivalence cases"
  - "Both helpers finish within the callWithinBudget budget on 1 MiB adversarial inputs"
  - "No regex in python-clients.ts or python-web.ts is flagged by CodeQL js/polynomial-redos"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "review-fixes"
  - "codeql"
  - "lang-python"
  - "pr-21"
source: "review"
---
