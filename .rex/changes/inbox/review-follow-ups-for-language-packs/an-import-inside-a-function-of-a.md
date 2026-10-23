---
id: "452790b2-6514-426b-99f9-9ba9a45326e9"
type: "task"
title: "An import inside a function of a package's __init__.py is followed as the package's attribute in WebProject.follow"
slug: "an-import-inside-a-function-of-a"
description: "Verdict: out-of-scope (pre-existing from f4b24b48; seen while reviewing fafda0f1, whose moduleOf path got the fix). Low.\n\nScenario, reproduced against the built pack:\n- app/api/__init__.py: `def setup():\\n    from .legacy import router\\n    return router`\n- app/api/router.py and app/api/legacy.py: each has `router = APIRouter()` with one route\n- app/main.py: `from app.api import router; app.include_router(router, prefix=\"/api\")`\n\nResult: legacy.py's route is mounted at /api/z and there is no notice. In Python, `from app.api import router` gives the submodule app/api/router.py, because the function-local import binds no attribute of the package. So the mount should be counted as not followed, and legacy keeps /z.\n\nCause: queries/python/imports.scm captures imports at any depth, so `WebFile.bindings` includes function-level and class-level imports. `WebProject.binds` and `follow` (packages/lang-python/src/python-web.ts) treat them as module-level. fafda0f1 added `Binding.nested` (an import inside a def or class) and uses it in `importedModule`. `follow` and `binds` do not use it yet.\n\nReachable through include_router, register_blueprint and DRF register counting, but only when a package __init__ imports, inside a function, a name equal to a sibling submodule. Rare.\n\nOptions:\n1. (Recommended) In `binds` and `follow`, ignore a binding with `nested` set, as `importedModule` does. Cost: a few lines plus a test. Risk: corpus routes could shift, so check byte-identity.\n2. Have readBindings drop nested imports entirely. Rejected: the importing file's own function-level imports are used elsewhere (pre-existing behaviour), so this has a wider blast radius."
acceptanceCriteria:
  - "With app/api/__init__.py importing `router` from .legacy only inside a def, and app/main.py `from app.api import router; include_router(router, prefix=\"/api\")`, legacy.py's route stays at /z and the mount is counted in the not-followed notice (new integration test in python-frameworks.test.ts fails today)"
  - "A module-level `from .router import router` re-export in __init__.py is still followed (existing re-export tests keep passing)"
  - "Framework goldens unchanged"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "frameworks"
source: "ndx-adversarial-review"
---
