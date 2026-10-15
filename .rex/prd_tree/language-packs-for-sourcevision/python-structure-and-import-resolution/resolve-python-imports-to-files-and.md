---
id: "98b93b54-6bba-4176-a717-f2640c8059f1"
level: "task"
title: "Resolve Python imports to files and feed Python edges into analyze"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "sourcevision"
  - "pr-15"
blockedBy:
  - "992d5c1d-998a-446d-913b-f971778b57ea"
  - "203cd7bb-3cc6-4e03-9898-6293f2e96467"
source: "roadmap"
acceptanceCriteria:
  - "The Python resolver resolves absolute, from-import submodule vs attribute, relative, src-layout and namespace-package imports to files, with notices for dots past the root"
  - "Externals are named by top-level module, matched to declared dependencies by PEP 503 normalisation only, and stdlib comes from a pinned Python 3.13 list with provenance"
  - "Python edges and externals reach imports.json through the pack path, and Python works in multi-language repositories"
  - "Byte-identical to PR 14 for repositories without Python and for Python repositories without the pack"
  - "Per-repo resolution rates, a 15+15 hand-checked sample, zone counts and analyze wall-clock (home-assistant, django) are logged; policy, lang-python and sourcevision suites pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Add the Python resolver to `@n-dx/lang-python` (a `PackResolver`, as Go and Java have) and let its edges reach the import graph through the same pack path Go and Java use (`buildPackImportGraph` → `mergeGraph`).\n\nResolution:\n- Source roots per project from the previous task's lang-kit readers; with no manifest, the repository root, plus any top-level directory that is a package. Several projects give several roots; an import resolves against the importing file's own project roots first, then the others.\n- Absolute `a.b.c`: `a/b/c.py`, else `a/b/c/__init__.py`, else a namespace-package directory (PEP 420: a directory on the path with no `__init__.py`; the edge targets its files that the import names, or is recorded as resolved-to-directory if the schema has no place for that — say which in the log). A `.pyi` beside a `.py` does not add a second edge; a `.pyi` alone is the target.\n- `from a.b import c`: the submodule `a/b/c.py` or `a/b/c/__init__.py` when it exists, otherwise `a/b` (c is an attribute). `from a import *` targets `a`.\n- Relative: from the importing file's package (`__init__.py` counts as the package itself); a dot count past the project root is unresolved with a notice.\n- Not found under any root: external, named by its top-level module. Match it to a declared dependency when the normalised import name equals the PEP 503-normalised distribution name (also with `-`/`_`/`.` folded); leave `yaml`/`PyYAML`-style mismatches unmatched and count them, never guess. Stdlib modules come from a list pinned to Python 3.13 with provenance (`sys.stdlib_module_names` as published in the docs), recorded as stdlib, not as third-party.\n- TYPE_CHECKING-only and ImportError-guarded imports still give edges; if the import edge schema has a type or confidence field that fits, use it; otherwise do not add a schema field (say so in the log).\n- Dynamic imports are not resolved.\n\nAnalyze: Python edges and externals are recorded like Go and Java ones; Python files then join zones (expected, and only with the pack). Python in a multi-language repository (Python beside TypeScript, as in full-stack-fastapi-template) works, as Java's multi-language task made it work for Java.\n\nBar (log every number in this task):\n- Byte-identical to PR 14 for every repository without Python, and for Python repositories without the pack (sourcevision's own tree, microservices-demo, terraform-aws-rds, workspace-crossings, petclinic; one Python corpus repo with the pack removed).\n- Per Python corpus repo with the pack: internal imports resolved / internal imports total (an import is internal when its top-level module is a package under one of the repo's roots), externals matched to declared dependencies / externals total, stdlib count, unresolved by reason; a hand-checked sample of 15 resolved and 15 unresolved imports per repo with file:line; and zone count before and after.\n- `sv analyze --fast` wall-clock on home-assistant/core and django with and without the pack.\n- Root policy suites, lang-python and sourcevision suites pass."
lastModified: "2026-10-15T22:06:34.457Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
