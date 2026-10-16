---
"@n-dx/lang-python": patch
"@n-dx/lang-runtime": patch
"@n-dx/sourcevision": patch
---

The Python pack produces `routes` through FastAPI, Flask and Django framework packs, so a Python repository's routes reach components.json `serverRoutes`. FastAPI `include_router`, Flask `register_blueprint` and Django `include` are followed across files through the pack's resolver, which a framework now receives as an optional third argument to `FrameworkPack.read`. A prefix or path that is not a literal is kept as written in `${expression}` form and counted in a notice; Django REST framework router registrations are counted, not expanded. Without the Python pack, or in a repository without Python, every artifact is unchanged.
