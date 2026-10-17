---
id: "441fba28-7dcd-46c6-a465-65165c84cab2"
level: "task"
title: "Give Python externals the python: namespace"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "decision"
  - "lang-python"
  - "pr-18"
source: "review"
startedAt: "2026-10-17T06:56:16.873Z"
completedAt: "2026-10-17T07:02:27.515Z"
endedAt: "2026-10-17T07:02:27.515Z"
resolutionType: "code-change"
resolutionDetail: "python-resolver emits python:<module> and python:stdlib:<module>; tests, goldens, AGENTS.md and changeset updated; sourcevision test proves npm and PyPI openai stay apart."
acceptanceCriteria:
  - "Every external the Python pack emits is python:<module> or python:stdlib:<module>"
  - "A TS+Python repo keeps npm and PyPI externals of the same name apart"
  - "Goldens and reports updated; non-Python output and no-pack output unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Ryan decided this on 2026-10-16 (#793 thread); implement it as written. The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Ryan's decision (2026-10-16, #793 thread on python-resolver.ts:384). Today a third-party Python import is recorded as its bare top-level module (openai, redis, yaml), and stdlib modules as their bare name. buildPackImportGraph keeps one external map across packs, and mergeGraph merges by package. So in a TS+Python repo, npm `openai` and PyPI `openai` become one imports.json external whose importedBy mixes .ts and .py files. In a Go+Python repo, Python's stdlib names collide with Go's `stdlib:os`/`time`/`io`.\n\nNow, in @n-dx/lang-python's resolver (packages/lang-python/src/python-resolver.ts), every external the Python pack emits starts with `python:`:\n- third-party imports become `python:<top-level module>` (`python:openai`, `python:yaml`);\n- stdlib becomes `python:stdlib:<module>` (`python:stdlib:os`).\n\nNames stay unique, so every consumer that keys on ExternalImport.package keeps working unchanged. Regenerate the lang-python goldens and update the tests and corpus reports that assert bare names (python-resolve-report.mjs). Any sourcevision code that special-cases Python externals by bare name must follow.\n\nLater, not in this task: an optional `dependency` field on ExternalImport, filled from what dependencyFor already resolves.\n\nExpected change: imports.json externals for Python repos with the pack gain the prefix. Everything else stays identical, including repos without Python and Python repos without the pack."
lastModified: "2026-10-17T07:02:27.832Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
