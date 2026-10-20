---
"@n-dx/lang-python": patch
---

The FastAPI, Flask and Django rules now follow `from pkg import name` into what `pkg/__init__.py` binds to `name`, so a router or blueprint that `__init__.py` re-exports from `pkg/name.py` gets its mount prefix (`include_router(router, prefix="/api")` gives `/api/x`, not `/x`). The name is taken as the submodule only when `__init__.py` binds nothing by that name.
