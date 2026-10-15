## lang-python

`@n-dx/lang-python` is the Python pack: the pinned tree-sitter-python grammar, `queries/python`, the pack definition and its symbol rules, the Python resolver and the Python goldens. It is opt-in (`ndx sv pack add python`): without it, Python files get inventory only.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time (`src/language/pack-loader.ts`: the per-user pack directory, then module resolution) and imports it dynamically; nothing in a package's `src` imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`, and it is the only export sourcevision reads; no tree-sitter type crosses into sourcevision. Other exports serve the corpus scripts in `packages/sourcevision/scripts` and tests in the workspace.
- **Finds its assets from its own root**: the grammar in `build/grammars`, queries in `queries/python`.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a Python interpreter or toolchain on the user's machine. Build files (`pyproject.toml`, `setup.cfg`, requirements) are read as text, and `setup.py` is never executed.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.
