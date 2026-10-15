## lang-python

`@n-dx/lang-python` is the Python pack: the pinned tree-sitter-python grammar, `queries/python`, the pack definition and its symbol rules, the Python resolver and the Python goldens. It is opt-in (`ndx sv pack add python`): without it, Python files get inventory only.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time (`src/language/pack-loader.ts`: the per-user pack directory, then module resolution) and imports it dynamically; nothing in a package's `src` imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`, and it is the only export sourcevision reads; no tree-sitter type crosses into sourcevision. Other exports serve the corpus scripts in `packages/sourcevision/scripts` and tests in the workspace.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, queries in `queries/python`.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a Python interpreter or toolchain on the user's machine. Build files (`pyproject.toml`, `setup.cfg`, requirements) are read as text, and `setup.py` is never executed.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### What it reads

- **Imports** (`src/python-imports.ts`, `queries/python/imports.scm` and `guards.scm`): one lang-kit `WrittenImport` per imported module, in `FileReferences.written`: the specifier with its leading dots (`..pkg`), the names (`*` for a wildcard, none for `import a.b`), the specifier's position, and `guard` (`type-checking` under `if TYPE_CHECKING:` or `if typing.TYPE_CHECKING:`, `optional` in a `try:` body whose handler catches `ImportError` or `ModuleNotFoundError`; the innermost guard wins). `from __future__` is never listed. `pythonResolver` does not resolve yet: `files` and `external` are empty, so sourcevision records no Python edges or externals.
- **Symbols** (`src/python-symbols.ts`): `class`, `function` (sync and async), `method` (a function whose nearest enclosing class or function is a class), `variable` (a name assigned directly at module level; tuple targets are not). `decorators` holds each decorator as written without `@`, and the span then starts at the first one. `__all__` carries `exports` only when its value is a list or tuple of plain string literals.
- **Calls** (`queries/python/calls.scm`): callee and receiver as written, positional string literals (f-strings are not literals).
- **Notices** (`src/python-notices.ts`): `importlib.import_module(…)`, `import_module(…)` and `__import__(…)` are counted, with the first five locations, when imports are wanted; they never become import facts.

tree-sitter-python 0.25.0 does not parse PEP 696 type parameter defaults (`class C[T = int]`); such files parse with ERROR nodes.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`. `test:update-goldens` rewrites the fixture's capture golden (`golden.json`, with the resolver's written imports) and the pack entry's facts and notices (`facts.json`) under `tests/fixtures/language-packs/python`; review the diff. `packages/sourcevision/scripts/python-corpus-clone.mjs` and `python-corpus-report.mjs` clone and measure the pinned corpus (`python-corpus.json`).
