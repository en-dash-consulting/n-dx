---
id: "b4ca7979-70ef-4f57-844f-d58ab2cec3d7"
type: "task"
title: "The computed-require policy test misses assignment, aliases, Module._load and .mjs/.cjs files"
slug: "the-computed-require-policy-test"
description: "Verdict: should-fix (a test that does not protect what it names). tests/e2e/architecture-policy.test.js:272-300 harvests createRequire names only from const/let/var declarations and scans only *.js. Not flagged: `let r; r = createRequire(import.meta.url); r(bin)`; `const load = _require; load(bin)`; `import Module from \"module\"; Module._load(bin)`; any .mjs/.cjs file in packages/core. Fix (recommended): track identifiers that receive a createRequire result by declaration or assignment and their aliases, flag _load(, scan .mjs/.cjs; or parse with acorn and allow-list call sites."
acceptanceCriteria:
  - "Each evasion form above is a flagged fixture in the policy test"
  - "packages/core .mjs and .cjs files are scanned"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
