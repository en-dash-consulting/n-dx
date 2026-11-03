---
"@n-dx/lang-python": patch
---

Keep FastAPI and Flask routes whose application or router is bound again without a competing import: a Flask factory module ending in `app = create_app()`, `app = FastAPI()` wrapped as `app = VersionedFastAPI(app)` or in middleware, and a module router sharing its name with a function-local one, each of which lost every route. A fallback bound in an `except ImportError:` clause no longer replaces the import its `try` body makes, and a function-local re-import in a package's `__init__.py` no longer hides the module-level import of the same name.
