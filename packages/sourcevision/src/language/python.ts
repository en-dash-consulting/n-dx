/**
 * Python language configuration.
 *
 * Defines extensions, skip directories, test/generated file patterns,
 * config filenames, and entry points specific to Python projects.
 *
 * @module sourcevision/language/python
 */

import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Python projects.
 *
 * Key Python-specific behaviors:
 * - Virtualenv and tool-cache directories (`venv/`, `.venv/`, `site-packages/`,
 *   `.tox/`, `.mypy_cache/`, …) are in `skipDirectories`. These hold vendored
 *   dependency code that would otherwise be inventoried as source files.
 * - `test_*.py` / `*_test.py` and `tests/` identify test files.
 * - `*_pb2.py` / `*_pb2_grpc.py` are generated (protobuf) files.
 * - `pyproject.toml` is the canonical module manifest.
 *
 * Note: `parseableExtensions` is intentionally empty — SourceVision has no
 * Python import parser (the import phase only parses JS/TS, Go, and Swift),
 * so `.py` files are inventoried and classified but not parsed for imports.
 */
export const pythonConfig: LanguageConfig = {
  id: "python",
  displayName: "Python",

  extensions: new Set([".py", ".pyi"]),

  parseableExtensions: new Set<string>(),

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
    "env",
    "site-packages",
    "__pycache__",
    ".tox",
    ".eggs",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".hypothesis",
    "build",
    "dist",
  ]),

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
