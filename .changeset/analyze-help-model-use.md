---
"@n-dx/core": patch
"@n-dx/sourcevision": patch
---

`ndx analyze --help` and `sv analyze --help` now list `--narrate` and say what the default mode, `--narrate`, `--fast` and `--deep` each send to a model.

A new "Model use" section says that the default run sends code facts to the configured model: file paths and roles, the zone structure, each file's leading doc comment and the project's rule documents, but never whole source files. `--fast` sends nothing. `--deep` analyses each sub-package first and adds no model use of its own. `ndx analyze --help` also lists `--wait` now, and no longer describes `--deep` as AI enrichment.
