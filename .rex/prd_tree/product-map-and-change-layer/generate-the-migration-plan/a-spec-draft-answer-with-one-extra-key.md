---
id: "6b18030d-a7c6-4b8c-8843-5a3affcf0e56"
level: "task"
title: "A spec draft answer with one extra key fails the whole text pass, so no later capability is redrafted and Jev placement does not run"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-13"
  - "product-map"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "createTextSpecModel accepts a reply with an extra top-level key and an extra per-criterion key, and returns the statement and criteria (test)"
  - "A reply missing statement or criteria is still refused (test)"
description: "Verdict: should-fix (medium), found by the adversarial review of d6419e1e.\n\nScenario: the model answers a spec question with valid JSON plus a benign extra key, such as {\"statement\": \"...\", \"criteria\": [...], \"notes\": \"...\"}, or a criterion with an extra \"reason\" field. createTextSpecModel (packages/rex/src/analyze/spec-draft-reason.ts, ResponseSchema with .strict() at the top level and on each criterion) throws \"wrong shape\". runPlanPipeline then marks the text pass incomplete and asks nothing more: every later capability keeps its template draft, held changes get no text placement, and the Jev pass does not run. A retry re-asks the same capability, and a model that habitually adds the key fails the same way, so the plan can never complete.\n\nReachable when `ndx migrate --plan` wires createTextSpecModel (not yet wired). spec-pass merge already validates the fields it uses (asSpecAnswer), and redraftSpec reads only statement, text, source and tests, so dropping unknown keys loses nothing.\n\nOptions:\n1. Recommended. Drop .strict() and keep the required fields typed. Cost: two lines plus a test. Risk: none, because unknown keys are ignored downstream.\n2. Keep strict, but on a shape error return a null answer so the template stands for that capability. Cost: moderate. Risk: it records a null answer, so a re-run reuses it until the inputs change.\n\nplacement-reason.ts has the same strict schema; check it in the same change.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-09T01:31:57.895Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
