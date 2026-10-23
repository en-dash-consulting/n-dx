---
id: "502ac1a1-b7b6-42e7-9c9b-38fc974fdd3d"
type: "change"
title: "Python structure and import resolution through @n-dx/lang-python (PR 15)"
slug: "python-structure-and-import-resolution"
intent: "Python is a lang-kit registry entry only today: `.py` files are inventoried and classified but never parsed, so they have no imports, no graph edges and no zones. This feature adds the opt-in `@n-dx/lang-python` pack (scaffolded in cd64d4b3e): the pinned tree-sitter-python grammar, structure facts (imports, symbols, calls), Python build readers in lang-kit (pyproject.toml, setup.cfg, requirements, literal-only setup.py), and an import resolver whose edges join the import graph. With the pack installed, Python files get edges and zones; without it, nothing changes. Frameworks (FastAPI/Flask/Django routes, requests/httpx outbound) are the next PR, through PR 14's framework slot. No Python interpreter or toolchain is used (LS16)."
acceptanceCriteria:
  - "@n-dx/lang-python is an opt-in known pack: `ndx sv pack add python` installs it and sourcevision loads it"
  - "With the pack, Python imports resolve to files (absolute, relative, src layout, namespace packages) and join the import graph; externals are named by top-level module and matched to declared dependencies"
  - "Every repo without Python, and Python repos without the pack, analyse byte-identically to PR 14"
  - "Python corpus clean-parse rate is at least 99.5% of .py files, with per-repo internal-import resolution rates and hand-checked samples logged"
touches:
  - "a7c0061e-eb80-473b-84b2-861194fbcc47"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "sourcevision"
  - "side-stack"
  - "pr-15"
source: "roadmap"
blockedBy:
  - "2147717e-b3b7-44b8-be38-bba001a14bc6"
---
