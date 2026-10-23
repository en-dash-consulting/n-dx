---
id: "fafda0f1-843b-42fc-be73-576f78fd5bd1"
type: "task"
title: "A module re-exported under another name by a package's __init__.py is not followed as an attribute base"
slug: "a-module-re-exported-under-another"
description: "Out-of-scope. This is a pre-existing finding from the adversarial review of f4b24b48 (follow re-exports through __init__.py). That task fixed WebProject.follow, the path for a bare name. WebProject.moduleOf (packages/lang-python/src/python-web.ts ~line 492) is the path for a dotted base such as `endpoints.router`. It still builds `pkg.name` as a submodule specifier and never looks at what pkg/__init__.py binds.\n\nTrigger (reproduced against the built pack):\n- app/api/__init__.py: `from .v1 import routes as endpoints`\n- app/api/v1/routes.py: `router = APIRouter()` with `@router.get(\"/x\")`\n- app/main.py: `from app.api import endpoints; app.include_router(endpoints.router, prefix=\"/api\")`\n\nResult: the route is GET /x, with the notice \"1 mount names no application or router the rules can follow: app/main.py:4 (include_router endpoints.router)\". Python mounts it at /api/x. Django's isRouter (django.ts:174) and Django `include(module)` calls go through the same moduleOf path.\n\nReachable from any FastAPI, Flask or Django project whose package __init__ re-exports a router module under an alias. This is rarer than the bare-name re-export that f4b24b48 fixed.\n\nFix options:\n(a) Recommended. In moduleOf, when the first segment's binding is `from pkg import name`, consult pkg/__init__.py first. If __init__ binds `name` by an import of a module, resolve that import's module (following further re-exports up to MAX_REEXPORTS). Fall back to the `pkg.name` submodule when __init__ binds nothing by that name. The cost is small and mirrors follow().\n(b) Leave it, and count the case in the existing not-followed notice (already done). There is no cost, but the prefix stays wrong.\n\nVerdict: out-of-scope (pre-existing, not introduced by f4b24b48), medium."
acceptanceCriteria:
  - "With app/api/__init__.py `from .v1 import routes as endpoints` and app/main.py `include_router(endpoints.router, prefix=\"/api\")`, the route in app/api/v1/routes.py is GET /api/x and no not-followed notice is reported"
  - "A dotted base whose package __init__.py binds nothing by that name still resolves to the submodule (existing `router.router` test keeps passing)"
  - "An integration test in packages/lang-python/tests/integration/python-frameworks.test.ts covers the aliased module re-export"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-python"
  - "frameworks"
source: "ndx-adversarial-review"
---
