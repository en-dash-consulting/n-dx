---
"@n-dx/lang-python": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/sourcevision": patch
---

The Python pack reads structure: the pinned tree-sitter-python 0.25.0 grammar, imports as written (relative dots kept, `TYPE_CHECKING` and `ImportError`-guarded imports marked, `from __future__` skipped), classes, functions, methods, decorators, module-level names and literal `__all__`, and calls; dynamic imports are counted in its notices. `ndx sv pack add python` installs it. Its imports are not resolved yet, so Python files still get no edges, and without the pack every artifact is unchanged.
