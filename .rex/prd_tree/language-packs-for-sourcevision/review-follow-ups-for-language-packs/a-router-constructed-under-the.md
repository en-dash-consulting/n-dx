---
id: "5b2ea100-4790-4834-9309-9e3d3f221f44"
level: "task"
title: "A router constructed under the imported name inside a function, or before the import, wins over the import in WebProject.follow"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "frameworks"
  - "pr-16"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With `from .items import router` and a `router = APIRouter()` only inside a function in main.py, `app.include_router(router, prefix=\"/api\")` mounts items.py's router at /api (new test fails today)"
  - "With `router = APIRouter()` before `from .items import router`, the import is followed"
  - "Existing framework goldens unchanged; corpus routes and notices byte-identical or the differences listed"
description: "Verdict: out-of-scope (pre-existing; seen while reviewing task 35351c50 / eff8b96e4). Low.\n\nScenario: app/main.py has `from .items import router`, then `def make():\\n    router = APIRouter()`, then `app.include_router(router, prefix=\"/api\")`. `WebProject.follow` (packages/lang-python/src/python-web.ts) checks `defines(file, name)` before anything else, and python-routers.ts builds `instances` from every constructor assignment in the file at any depth (the fastapi/flask assignment queries are not module-anchored). So `defines(main.py, \"router\")` is true, `follow` returns main.py's function-local router, and the imported router in items.py is never mounted: its routes keep no `/api` prefix. Same with `router = APIRouter()` placed before the import (the import wins in Python). Django's `routers` set has the same shape for `…Router(…)` assignments.\n\nReachable through `include_router`, `register_blueprint`, and DRF `register` counting. Rare in real code.\n\nOptions:\n1. (Recommended) Give `defines` the position it accepts (or have instances record whether the assignment is module-level and where), and in `follow` prefer the import when its binding comes after the local definition or the local definition is not module-level. Cost: small change in python-routers.ts/django.ts instance maps and `follow`. Risk: corpus routes could shift; verify byte-identity.\n2. Anchor the framework assignment queries at module level. Rejected alone: an app built inside a factory function (`def create_app(): app = Flask(...)`) is a real pattern the rules rely on."
lastModified: "2026-10-16T17:18:15.606Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
