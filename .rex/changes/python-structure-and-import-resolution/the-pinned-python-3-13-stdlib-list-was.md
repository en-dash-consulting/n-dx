---
id: "11eaa37d-14d4-4aba-b6ec-4cded856d08f"
type: "task"
title: "The pinned Python 3.13 stdlib list was transcribed, not checked against CPython's stdlib_module_names.h"
slug: "the-pinned-python-3-13-stdlib-list-was"
description: "Verdict: should-fix (low).\n\n`packages/lang-python/src/python-stdlib.ts` (`PYTHON_STDLIB_MODULES`) cites `Python/stdlib_module_names.h` at 3.13 as its provenance. Task 98b93b54 could neither fetch that file nor run a Python 3.13 interpreter, so the list was written by hand. It was cross-checked only against a local Python 3.14.7 install's Lib and lib-dynload directories, with the 3.14 additions removed.\n\nPublic module names agree with that install. Private and builtin entries were not verified: `_apple_support`, `_suggestions`, `_sysconfig`, `_gdbm`, `_tkinter`, `_overlapped`, `_wmi`, `_compression`, and builtins such as `sys`, `posix` and `nt`.\n\nFailure scenario: if an entry is wrong, an `import X` whose top-level module is X is recorded as `stdlib:X` when it is third-party, or as a third-party external when it is stdlib. Only private underscore names are at risk, so imports.json would show only rare misclassification.\n\nReachable through `sv analyze` with the Python pack on any repository importing such a name.\n\nFix: diff the list against the CPython v3.13 header (a networked fetch, or `python3.13 -c \"import sys; print(sorted(sys.stdlib_module_names))\"`), correct any entries, and add a test pinning the list's size. Cost: minutes. Risk: none."
acceptanceCriteria:
  - "PYTHON_STDLIB_MODULES equals sys.stdlib_module_names of CPython 3.13 (Python/stdlib_module_names.h at a v3.13.x tag), with the tag recorded in PYTHON_STDLIB_PROVENANCE"
  - "A lang-python test pins the list's entry count to that header's count"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "pr-15"
source: "ndx-adversarial-review"
---
