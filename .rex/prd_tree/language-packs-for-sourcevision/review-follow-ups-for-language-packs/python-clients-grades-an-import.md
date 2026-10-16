---
id: "4a951a7d-7d31-4cd2-b601-3c6a6bf4e1b9"
level: "task"
title: "python-clients grades an import-qualified call certain when a parameter or local shadows the imported module name"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "outbound"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A call `requests.get(url)` inside `def f(requests):` with `import requests` at module level is not reported as certain (a lang-python integration test fails today)"
  - "`os.getenv(\"X\")` after a function-local `os = make()` is not reported as an env lookup"
  - "A function-level `import requests` followed by `requests.get(url)` is still reported as certain"
description: "Verdict: out-of-scope (pre-existing from 09c1b5968; found reviewing the 4fc19c07 scoping fix). Severity low.\n\nScenario: `import requests` at module level, then `def f(requests): requests.get(url)`, or a local `os = make()` followed by `os.getenv(\"X\")`. The callee is qualified through readWebFile's file-wide import bindings (`qualify` in packages/lang-python/src/python-clients.ts), which ignore scope. So the call is reported `http requests certain` / `env os.getenv certain` even though the name is local to the function. 4fc19c07 fixed this for client receivers (readScopes) but not for import-qualified callees. The os.environ subscript reading has the same gap.\n\nReachability: ndx sv analyze with the Python pack, outbound.json. Rare in practice: a parameter or local named after an imported HTTP, gRPC or env module.\n\nOptions:\n1. (Recommended) In readPythonClientFile, before qualifying a call's first segment, resolve the name with readScopes. If it resolves to a non-module scope whose bindings include a non-import binding, treat it as not qualified. Function-level imports must keep qualifying, so binding kinds need to be told apart (a separate capture for import bindings). Cost: a capture name and a check. Risk: low.\n2. Leave as is, and document the limit in the AGENTS.md confidence rule."
lastModified: "2026-10-16T01:56:29.432Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
