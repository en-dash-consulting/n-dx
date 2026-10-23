---
id: "9055527f-926c-463c-a7a7-de62eaa0b78b"
type: "task"
title: "Python skip directories hide real packages named env (or build, dist)"
slug: "python-skip-directories-hide-real"
description: "`pythonConfig.skipDirectories` (lang-kit `python.ts`) lists `env`, `build` and `dist` for virtualenvs and build output, and they are skipped at any depth. Real packages with those names vanish from the inventory: in the corpus, poetry's `src/poetry/utils/env/`, `src/poetry/console/commands/env/` and two test packages (each has `__init__.py`). Task 98b93b54 found it as poetry's 100 unresolved `poetry.utils.env` imports. Pre-existing on main, and it applies whether or not the Python pack is installed.\n\nFix options: skip `env`/`build`/`dist` only when the directory is not a package (no `__init__.py`), or only when it looks like a virtualenv (`pyvenv.cfg`, `bin/activate`) or build output. Fixing it changes inventory.json for Python repos that have such packages, with or without the pack. That is outside PR 15's byte-identity bar, so run it separately and say so in its PR."
acceptanceCriteria:
  - "A directory named env, build or dist that is a Python package (has __init__.py) is inventoried; virtualenvs and build output are still skipped"
  - "poetry's src/poetry/utils/env and console/commands/env are in the inventory and their imports resolve with the pack"
  - "The inventory change for Python repositories is reported; non-Python repositories are byte-identical"
priority: "low"
tags:
  - "language-packs"
  - "lang-python"
  - "lang-kit"
  - "follow-up"
source: "review"
---
