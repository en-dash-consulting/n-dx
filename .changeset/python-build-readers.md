---
"@n-dx/lang-kit": patch
---

lang-kit reads Python project metadata as text: `pyproject.toml` (PEP 621, dependency groups, Poetry, setuptools, hatch, uv workspace), `setup.cfg`, requirements files with `-r`/`-c` includes, and the literal arguments of `setup.py`'s `setup(...)`, which is never executed. Each project gives its name, source roots, listed packages and PEP 503-named dependencies with file and line; malformed input becomes a notice. The TOML reader now accepts arrays of tables, multi-line strings and digit separators. Nothing in sourcevision uses the readers yet, so analysis output is unchanged.
