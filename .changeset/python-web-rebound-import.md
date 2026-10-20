---
"@n-dx/lang-python": patch
---

The FastAPI, Flask and Django rules no longer follow an imported name that the file binds again at module level after the import (`from .routers import router` then `router = make_other()`): a mount through it is not followed, and a `router.register(…)` on it is not counted as a Django REST framework registration.
