---
id: "992d5c1d-998a-446d-913b-f971778b57ea"
level: "task"
title: "Python pack: grammar, structure queries, goldens and opt-in registration"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "pr-15"
source: "roadmap"
startedAt: "2026-10-15T22:07:04.311Z"
completedAt: "2026-10-15T22:29:36.978Z"
endedAt: "2026-10-15T22:29:36.978Z"
resolutionType: "code-change"
resolutionDetail: "@n-dx/lang-python pack: pinned tree-sitter-python 0.25.0, imports/guards/definitions/variables/calls queries, written-import facts, symbols with decorators and __all__, dynamic-import notices, goldens; opt-in KNOWN_PACK; Python corpus pinned and measured (clean parse >= 99.94%)."
acceptanceCriteria:
  - "tree-sitter-python is pinned with its SHA-256 in build-grammars.mjs and @n-dx/lang-python builds its grammar with build:grammars"
  - "The Python pack entry produces imports, symbols and calls facts; a golden fixture covers every import form listed, TYPE_CHECKING and ImportError-guarded imports, __all__, decorators and async functions"
  - "Python is an opt-in KNOWN_PACK: `sv pack add python` installs it; with it missing, every artifact is byte-identical to PR 14 (Python and non-Python repos)"
  - "The Python corpus is pinned and cloned, and its report logs clean-parse rate (target at least 99.5%), capture counts, notices and parse time per repo"
  - "Root policy suites and the lang-python and sourcevision suites pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Fill the scaffolded `@n-dx/lang-python` (cd64d4b3e: package.json, tsconfig, vitest, AGENTS.md, a placeholder barrel; already wired into sourcevision devDependencies, changesets, release lists, CI and the pack-tier policy). Follow `@n-dx/lang-go` and `@n-dx/lang-java` for layout: `src/package-paths.ts`, `src/python-pack.ts`, `src/pack.ts` (createPackEntry), `queries/python`, `tests/fixtures/language-packs/python` with `golden.json`.\n\nGrammar: pin tree-sitter-python (the current release tag; its source archive and SHA-256) in `packages/lang-runtime/scripts/build-grammars.mjs` beside the others, add the package's `build:grammars` script (`--out build/grammars tree-sitter-python`) and `test:update-goldens`, and add `lang-python` to the grammar list in `packages/sourcevision/tests/e2e/packed-tarball.test.ts`. Provenance per rule as the other packs record it (grammar version, Python 3.13 syntax, verified date, source URL).\n\nStructure queries and facts (lang-kit kinds `imports`, `symbols`, `calls`):\n- imports: `import a.b`, `import a.b as c`, `from a.b import c, d as e`, `from . import x`, `from ..pkg import y`, `from x import *`, parenthesized and multi-line import lists, imports inside functions/classes/conditionals; skip `from __future__ import …`. Each import fact carries its module specifier with leading dots kept (`..pkg`), the imported names, and the position. Record whether it sits under `if TYPE_CHECKING:` (or `typing.TYPE_CHECKING`) or inside a `try:` whose handler catches `ImportError`/`ModuleNotFoundError`, using the fact fields lang-kit already has; if none fits, add an optional field to the contract additively and say so in the task log.\n- symbols: classes, functions (sync and async), methods, decorators on each, and module-level names; `__all__` when it is a literal list or tuple of strings.\n- calls: callee and receiver as the other packs record them.\n- Dynamic imports (`importlib.import_module`, `__import__`) are counted in the pack's notices, not turned into import facts.\n\nRegistration: add Python to sourcevision's `KNOWN_PACKS` in `src/language/pack-loader.ts` (opt-in, like Java: not an optional dependency) so `ndx sv pack add python` installs it and `pack list` shows it. Set `pythonConfig.parseableExtensions` so the imports phase hands `.py`/`.pyi` files to the pack, but only through the pack path: with the pack missing, Python files stay inventory-only (the existing missing-pack notice; no regex fallback) and every artifact is byte-identical to PR 14. Without resolution (next tasks), the pack's import facts produce no edges yet; check the imports phase does not record half-resolved Python edges or externals in this task.\n\nCorpus: `packages/sourcevision/scripts/python-corpus.json` (pinned commits) with clone and report scripts beside the Java ones, into `~/.cache/ndx-python-corpus`: django, netbox-community/netbox, python-poetry/poetry, fastapi/full-stack-fastapi-template, home-assistant/core (scale and timing only). The report prints per repo the `.py`/`.pyi` count, clean-parse rate (files with no ERROR/MISSING nodes), capture counts per query, notices (dynamic imports), and parse time. Log the numbers in this task.\n\nNo changes to rex, hench, core or web. Root policy suites must pass."
lastModified: "2026-10-15T22:29:37.321Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
