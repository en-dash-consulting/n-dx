/**
 * Python language configuration.
 *
 * Defines extensions, skip directories, test/generated file patterns,
 * config filenames, and entry points specific to Python projects.
 *
 * @module lang-kit/python
 */

import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Python projects.
 *
 * Key Python-specific behaviors:
 * - Virtualenv and tool-cache directories (`venv/`, `.venv/`, `site-packages/`,
 *   `.tox/`, `.mypy_cache/`, …) are in `skipDirectories`. These hold vendored
 *   dependency code that would otherwise be inventoried as source files.
 *   `env/`, `build/` and `dist/` are skipped only when they are not packages.
 * - `test_*.py` / `*_test.py` and `tests/` identify test files.
 * - `*_pb2.py` / `*_pb2_grpc.py` are generated (protobuf) files.
 * - `pyproject.toml` is the canonical module manifest.
 *
 * - `.py` and `.pyi` are parseable, but only by the opt-in `@n-dx/lang-python`
 *   pack: SourceVision has no other Python parser, so without the pack Python
 *   files are inventoried and classified only.
 */
export const pythonConfig: LanguageConfig = {
  id: "python",
  displayName: "Python",

  extensions: new Set([".py", ".pyi"]),

  parseableExtensions: new Set([".py", ".pyi"]),

  testFilePatterns: [
    /(?:^|\/)test_[^/]*\.py$/,
    /_test\.py$/,
    /(?:^|\/)tests?\//,
  ],

  configFilenames: new Set([
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "requirements-dev.txt",
    "Pipfile",
    "Pipfile.lock",
    "tox.ini",
    "mypy.ini",
    ".flake8",
    ".pylintrc",
    "conftest.py",
    "Makefile",
    "GNUmakefile",
  ]),

  skipDirectories: new Set([
    "venv",
    ".venv",
    "site-packages",
    "__pycache__",
    ".tox",
    ".eggs",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".hypothesis",
  ]),

  // A virtualenv or build output, unless the directory is a regular package
  // (poetry's `src/poetry/utils/env/`). A namespace package of these names,
  // with no `__init__`, is still skipped.
  skipUnlessContains: new Map(
    ["env", "build", "dist"].map((name) => [name, ["__init__.py", "__init__.pyi"]]),
  ),

  generatedFilePatterns: [
    /_pb2\.py$/,
    /_pb2_grpc\.py$/,
  ],

  entryPointPatterns: [
    /(?:^|\/)__main__\.py$/,
    /(?:^|\/)main\.py$/,
    /(?:^|\/)manage\.py$/,
    /(?:^|\/)wsgi\.py$/,
    /(?:^|\/)asgi\.py$/,
  ],

  moduleFile: "pyproject.toml",
};
