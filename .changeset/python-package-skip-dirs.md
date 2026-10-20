---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
---

A Python project's `env`, `build` or `dist` directory is now skipped only when it is not a package: one holding `__init__.py` (poetry's `src/poetry/utils/env/`) is inventoried, while virtualenvs and build output are still skipped. This changes `inventory.json` for Python projects with such packages, whether or not the Python pack is installed; other projects are unchanged.
