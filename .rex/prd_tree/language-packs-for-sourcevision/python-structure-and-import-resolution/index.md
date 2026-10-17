---
id: "502ac1a1-b7b6-42e7-9c9b-38fc974fdd3d"
level: "feature"
title: "Python structure and import resolution through @n-dx/lang-python (PR 15)"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "sourcevision"
  - "side-stack"
  - "pr-15"
blockedBy:
  - "2147717e-b3b7-44b8-be38-bba001a14bc6"
source: "roadmap"
acceptanceCriteria:
  - "@n-dx/lang-python is an opt-in known pack: `ndx sv pack add python` installs it and sourcevision loads it"
  - "With the pack, Python imports resolve to files (absolute, relative, src layout, namespace packages) and join the import graph; externals are named by top-level module and matched to declared dependencies"
  - "Every repo without Python, and Python repos without the pack, analyse byte-identically to PR 14"
  - "Python corpus clean-parse rate is at least 99.5% of .py files, with per-repo internal-import resolution rates and hand-checked samples logged"
description: "Python is a lang-kit registry entry only today: `.py` files are inventoried and classified but never parsed, so they have no imports, no graph edges and no zones. This feature adds the opt-in `@n-dx/lang-python` pack (scaffolded in cd64d4b3e): the pinned tree-sitter-python grammar, structure facts (imports, symbols, calls), Python build readers in lang-kit (pyproject.toml, setup.cfg, requirements, literal-only setup.py), and an import resolver whose edges join the import graph. With the pack installed, Python files get edges and zones; without it, nothing changes. Frameworks (FastAPI/Flask/Django routes, requests/httpx outbound) are the next PR, through PR 14's framework slot. No Python interpreter or toolchain is used (LS16)."
lastModified: "2026-10-15T22:05:36.134Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [An imports-only re-run keeps Python in analysedLanguages after the Python pack is gone](./an-imports-only-re-run-keeps-python-in.md) | pending |
| [List Python in inventory analysedLanguages when the Python pack loads](./list-python-in-inventory.md) | completed |
| [Python build readers in lang-kit: pyproject.toml, setup.cfg, requirements and setup.py](./python-build-readers-in-lang-kit.md) | completed |
| [Python pack: grammar, structure queries, goldens and opt-in registration](./python-pack-grammar-structure-queries.md) | completed |
| [Python skip directories hide real packages named env (or build, dist)](./python-skip-directories-hide-real.md) | pending |
| [Resolve Python imports to files and feed Python edges into analyze](./resolve-python-imports-to-files-and.md) | completed |
| [The pinned Python 3.13 stdlib list was transcribed, not checked against CPython's stdlib_module_names.h](./the-pinned-python-3-13-stdlib-list-was.md) | completed |
| [toml-lite accepts [[a]] and [a] headers that extend a static array or an inline table](./toml-lite-accepts-a-and-a-headers-that.md) | completed |
| [Align lang-python with 0.9.1 and list it in RELEASING.md](./align-lang-python-with-0-9-1-and-list.md) | pending |
