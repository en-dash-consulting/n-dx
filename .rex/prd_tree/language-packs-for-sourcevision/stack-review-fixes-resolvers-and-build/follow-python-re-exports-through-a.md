---
id: "f4b24b48-f93b-4bdd-b382-23e229ba28f9"
level: "task"
title: "Follow Python re-exports through a package's __init__.py"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "lang-python"
  - "frameworks"
  - "pr-18"
source: "review"
acceptanceCriteria:
  - "A name re-exported by a package's __init__.py is followed to its definition, so the mount prefix applies"
  - "A true submodule import (the __init__ neither defines nor imports the name) still resolves to the submodule"
  - "Fixtures for FastAPI, Flask and DRF re-exports pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#796, python-web.ts around line 482, line 521 at the stack top). `from pkg import name` is never followed when pkg/name.py exists, even if pkg/__init__.py re-exports name. A common layout:\n- app/api/router.py: `router = APIRouter()`, with `@router.get(\"/x\")`;\n- app/api/__init__.py: `from .router import router`;\n- app/main.py: `from app.api import router; app.include_router(router, prefix=\"/api\")`.\n\nPython returns the __init__ attribute, the APIRouter, so the route is GET /api/x. WebProject.follow sees that app.api.router resolves to a module file and returns undefined, so the mount counts as not followed and the route is emitted as /x. Flask blueprints and DRF routers take the same path.\n\nFix: follow into module(file, binding.module) first, meaning the package's __init__. Treat the name as a submodule only when that __init__ neither defines nor imports it. Keep PR 16c's rebinding rule (a later module-level rebinding wins). Add fixtures for FastAPI, Flask and a DRF router re-exported through __init__. Expected change: routes in corpus repos that use this layout may gain their mount prefix. The session checks the corpus and hand-checks any changed route."
lastModified: "2026-10-17T06:55:45.925Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
