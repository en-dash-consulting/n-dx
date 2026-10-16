---
id: "bfc8e82b-0f2c-4731-911e-1f5cdc9c5474"
level: "task"
title: "The Django query captures every list and tuple, adding seconds to large Python data files in every analyze"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-python"
  - "frameworks"
  - "performance"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a file of 8,000 tuple rows and 8,000 calls, the django query's parse-plus-captures time is within 1.5x of the fastapi query's (measured by a script like the review's qprof.mjs, numbers logged)"
  - "The django routes golden (tests/fixtures/django/facts.json) and the Django tests in python-frameworks.test.ts are unchanged"
  - "No @django.sequence is captured for a list that is neither a urlpatterns value, an include() argument nor a list holding a path()/re_path() call (asserted on captures in a test)"
description: "Verdict: should-fix (medium). Found by the adversarial review of e589b220 (PR 16 routes).\n\nScenario: a Python file with a large data table (TABLE = [(\"a0\", 0, [0, 1]), ...] with 8,000 rows plus 8,000 calls, about 16k lines) in a repository analysed with the Python pack. Since PR 16, analyze always asks for routes. Measured parse-plus-captures time per query on that file: Python queries 830 ms, fastapi 748 ms, flask 992 ms, django 2,693 ms. At a quarter of the size: 273, 247, 195 and 442 ms. So the Django query costs 3x the Python pack's own queries and grows faster than linearly.\n\nEvidence: packages/lang-python/queries/django/django.scm. `(list (_) @django.item) @django.sequence` and `(tuple (_) @django.item) @django.sequence` match every list and tuple in every file. The `(assignment ... right: (list))` pattern also matches every module-level list. The readers are no longer the cost: after the review's fix (innermostEach, and callSites by position), readWebFile takes 120-270 ms per framework on that file.\n\nReachable: `sv analyze` / `ndx analyze` on any Python repository with the pack installed (the imports phase asks for imports+routes), and `--phase` runs through readPackFrameworkFacts.\n\nOptions:\n1. (Recommended) Narrow the Django sequence captures to where URL patterns can be: the right side of `urlpatterns =` / `+=` (including `+` operands), the arguments of `include(...)` (list, tuple, and a list inside that tuple), and lists bound to a name only when they contain a `path`/`re_path` call (`(list (call function: ...) )` with #match?). Cost: query edits plus fixture checks. Risk: a pattern list built some other way (`list(...)`, comprehension) was never read anyway.\n2. Skip the framework reads, and their query captures, for files with no framework syntax. Not possible at the query level, because the runner runs every query over every file. It could only cut reader time, which is no longer the cost.\n3. Accept the cost. A 16k-line data file is rare in application code, but Django's own test suite and generated modules contain them."
lastModified: "2026-10-16T00:33:55.014Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
