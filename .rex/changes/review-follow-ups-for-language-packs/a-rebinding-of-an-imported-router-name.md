---
id: "278055d7-6995-4a91-8995-51d43aa7e4e6"
type: "task"
title: "A rebinding of an imported router name under a module-level if or try is not seen, so the import is still followed"
slug: "a-rebinding-of-an-imported-router-name"
description: "Verdict: should-fix (low). Found by the adversarial review of task 35351c50 (eff8b96e4).\n\nScenario: `from .routers import router` then, at module level, `if DEBUG:\\n    router = make_other()` (or the same in a `try`/`except` body), then `router.register(...)` or `app.include_router(router)`. `readModuleBound` (packages/lang-python/src/python-web.ts) reads module-level assignments from `queries/python/variables.scm`, which captures only assignments that are direct children of the module. The nested rebinding is not seen, so `WebProject.follow` still follows the import: the register call is counted as a DRF registration and the mount reaches the imported router. The task's run notes asked for these to count as module-level bindings by position; the change documented the gap in lang-python AGENTS.md instead.\n\nReachable through every framework rule that uses `WebProject.defined` (django.ts `isRouter`, python-routers.ts `instanceAt`). Rare in real code; the common `try: from x import r / except ImportError: r = None` pattern rebinds before or instead of the import and is unaffected either way.\n\nOptions:\n1. (Recommended) Add a capture of identifier-target assignments that are inside no function or class to each framework query (fastapi, flask, django; a shared snippet), and read it in `readModuleBound` in place of or beside `variables`. Cost: three query edits plus reader; no Python-golden change because the Python queries are untouched. Risk: corpus routes/notices could change where a repo rebinds conditionally — verify byte-identity.\n2. Widen `variables.scm` to nested module-level statements. Rejected: changes the Python symbols golden and corpus symbol output."
acceptanceCriteria:
  - "`from .routers import router` followed by a module-level `if X:\\n    router = make_other()` and `router.register(...)` is not counted as a DRF registration (new test in python-frameworks.test.ts fails today)"
  - "The same holds for a rebinding in a module-level `try` body, and for a FastAPI include_router through such a name"
  - "Python pack golden unchanged; corpus routes and notices byte-identical or the differences listed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "frameworks"
  - "pr-16"
source: "ndx-adversarial-review"
---
