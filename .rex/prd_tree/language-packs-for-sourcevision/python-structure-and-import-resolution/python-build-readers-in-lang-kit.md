---
id: "203cd7bb-3cc6-4e03-9898-6293f2e96467"
level: "task"
title: "Python build readers in lang-kit: pyproject.toml, setup.cfg, requirements and setup.py"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "lang-kit"
  - "pr-15"
blockedBy:
  - "992d5c1d-998a-446d-913b-f971778b57ea"
source: "roadmap"
startedAt: "2026-10-15T22:34:44.723Z"
completedAt: "2026-10-15T22:45:45.359Z"
endedAt: "2026-10-15T22:45:45.359Z"
resolutionType: "code-change"
resolutionDetail: "lang-kit Python build readers (pyproject/setup.cfg/requirements/setup.py) with unit tests and a corpus report script; toml-lite extended."
acceptanceCriteria:
  - "lang-kit reads pyproject.toml (PEP 621, Poetry, setuptools, hatch, uv workspace), setup.cfg (INI), requirements files with includes, and literal setup.py arguments, as text, without executing anything"
  - "Each project yields its source roots, declared packages and PEP 503-normalised dependencies with file and line; malformed input yields notices, not exceptions"
  - "Unit tests cover flat, src, Poetry from, setuptools package-dir, hatch sources, uv workspace and a requirements include cycle"
  - "The readers run over the whole Python corpus with per-repo projects, roots and dependency counts logged"
  - "lang-kit stays dependency-free; sourcevision output is unchanged; root policy suites pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Read Python project metadata as text, in `@n-dx/lang-kit` beside the Maven, Gradle and go.mod readers (`build-model.ts`, `java-maven-build.ts`, `go-build.ts`), returning the shared build model where it fits. No Python interpreter, pip or toolchain is ever run (LS16), and `setup.py` is never executed. lang-kit stays dependency-free and reads no config.\n\nPer project directory (a directory holding `pyproject.toml`, `setup.cfg` or `setup.py`; a monorepo has several):\n- `pyproject.toml` via the existing `toml-lite.ts` (extend it only if a needed TOML form is missing, with tests): `[project]` name, `dependencies`, `optional-dependencies`; `[tool.poetry]` name, `packages` (`include`/`from`), `dependencies` and group dependencies; `[tool.setuptools]` `packages`, `package-dir`, `packages.find` `where`; hatch `[tool.hatch.build.targets.wheel] packages`/`sources`; `[tool.uv.workspace] members` (globs expanded against the inventory, not the disk).\n- `setup.cfg`: a small INI reader in lang-kit (sections, keys, multi-line values, comments): `[metadata] name`, `[options] packages`, `package_dir`, `install_requires`, `[options.packages.find] where`.\n- `requirements*.txt` (and `-r`/`-c` includes within the repository, cycles stopped): requirement names and version specifiers; `-e`/URL/path lines recorded as written; environment markers kept as written.\n- `setup.py`: only literal keyword arguments to `setup(...)` (`name`, `packages=[...]`, `package_dir={...}`, `install_requires=[...]`), read as text; `find_packages(...)` with a literal `where` gives a source root; anything else yields a notice, never a guess.\n\nOutput per project: name, declared source roots (src layout, package-dir mappings, find `where`), declared top-level packages when listed, and dependencies (distribution name normalised per PEP 503, version spec as written, the file and line it came from). Malformed files yield a notice, not a throw.\n\nTests: unit tests per reader and per layout (flat, src, poetry `from`, setuptools package-dir, hatch sources, uv workspace, requirements includes with a cycle). Corpus check: run the readers over every project directory in `~/.cache/ndx-python-corpus` (task 1's corpus) and log per repo the projects found, roots, and dependency counts, with notices. Nothing in sourcevision changes in this task, so every artifact stays byte-identical."
lastModified: "2026-10-15T22:45:45.655Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
