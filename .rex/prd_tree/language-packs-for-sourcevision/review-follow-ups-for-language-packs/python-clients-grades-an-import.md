---
id: "4a951a7d-7d31-4cd2-b601-3c6a6bf4e1b9"
level: "task"
title: "python-clients grades an import-qualified call certain when a parameter or local shadows the imported module name"
status: "in_progress"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "outbound"
source: "ndx-adversarial-review"
startedAt: "2026-10-16T02:20:45.661Z"
acceptanceCriteria:
  - "A call `requests.get(url)` inside `def f(requests):` with `import requests` at module level is not reported as certain (a lang-python integration test fails today)"
  - "`os.getenv(\"X\")` after a function-local `os = make()` is not reported as an env lookup"
  - "A function-level `import requests` followed by `requests.get(url)` is still reported as certain"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Take option 1 and reuse 4fc19c07's readScopes. A name that a function binds other than by import (a parameter, an assignment, a for/with/except target, and so on) is local, and an import-qualified callee on it is not qualified. Function-level imports still qualify. global and nonlocal follow 4fc19c07's handling. This covers `requests.get`/`httpx`/`grpc`/`os.getenv` callees and the `os.environ[...]` subscript. Ship as one commit on feat/sv-lang-pr16-python-frameworks with a changeset. The hench sandbox may block the network and ~/.cache/ndx-python-corpus. If it does, leave the corpus run and the byte-identity checks to the session, which verifies them; do not capture follow-ups for them."}
description: "Verdict: out-of-scope (pre-existing from 09c1b5968; found reviewing the 4fc19c07 scoping fix). Severity low.\n\nScenario: `import requests` at module level, then `def f(requests): requests.get(url)`, or a local `os = make()` followed by `os.getenv(\"X\")`. The callee is qualified through readWebFile's file-wide import bindings (`qualify` in packages/lang-python/src/python-clients.ts), which ignore scope. So the call is reported `http requests certain` / `env os.getenv certain` even though the name is local to the function. 4fc19c07 fixed this for client receivers (readScopes) but not for import-qualified callees. The os.environ subscript reading has the same gap.\n\nReachability: ndx sv analyze with the Python pack, outbound.json. Rare in practice: a parameter or local named after an imported HTTP, gRPC or env module.\n\nOptions:\n1. (Recommended) In readPythonClientFile, before qualifying a call's first segment, resolve the name with readScopes. If it resolves to a non-module scope whose bindings include a non-import binding, treat it as not qualified. Function-level imports must keep qualifying, so binding kinds need to be told apart (a separate capture for import bindings). Cost: a capture name and a check. Risk: low.\n2. Leave as is, and document the limit in the AGENTS.md confidence rule."
lastModified: "2026-10-16T02:20:45.968Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
