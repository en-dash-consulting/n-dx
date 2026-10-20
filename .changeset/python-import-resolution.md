---
"@n-dx/lang-python": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/sourcevision": patch
---

The Python pack resolves imports: absolute, from-import submodule or attribute, relative, src-layout and namespace-package imports become edges to project files across each project's source roots, so Python files join the import graph and zones, beside TypeScript in a mixed repository. Externals are named `python:<top-level module>`, so npm and PyPI packages of the same name stay apart; stdlib is `python:stdlib:<module>` from a pinned Python 3.13 list, and a third-party module is matched to a declared dependency by PEP 503 name only. A target imported only under `TYPE_CHECKING` is a `type` edge. Without the pack every artifact is unchanged.
