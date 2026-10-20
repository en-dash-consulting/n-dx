---
"@n-dx/lang-python": patch
---

The FastAPI, Flask and Django rules now follow a module that a package's `__init__.py` re-exports under another name when it is the base of a dotted name or a Django `include(module)`. With `from .v1 import routes as endpoints` in `app/api/__init__.py`, `include_router(endpoints.router, prefix="/api")` gives `/api/x`, not `/x`. A name `__init__.py` binds to an object rather than a module is no longer taken as the submodule of the same name.
