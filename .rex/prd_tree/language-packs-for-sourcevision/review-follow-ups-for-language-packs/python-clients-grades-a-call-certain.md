---
id: "4fc19c07-7dc9-4872-bcc9-91dad59f02c2"
level: "task"
title: "python-clients grades a call certain when a parameter or a non-client local shadows a module-level client"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-python"
  - "outbound"
  - "pr-16"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A call on a function parameter that shares its name with a module-level client is not reported as certain (a lang-python integration test fails today)"
  - "A call on a name a function assigns from a non-client call before using it is not reported as certain"
  - "A module-level client used in a function that neither takes nor assigns that name is still reported as certain"
  - "home-assistant analyze wall-clock with the pack is logged before and after the change"
description: "Verdict: should-fix (severity medium). Found by the adversarial review of 32e56fc0.\n\nScenario (reproduced with a probe file): `session = requests.Session()` at module level, then `def a(session): session.get(url)`, or `def b(): session = make_other(); session.get(url)`. Both calls are reported as `http requests certain`. In Python the parameter and the local assignment make `session` local to the function, so the receiver is not known to be the client.\n\nEvidence: packages/lang-python/src/python-clients.ts, `lookup` in readPythonClientFile. It falls back to the module scope whenever the call's scope has no captured binding, but the query (queries/python-clients/python-clients.scm) captures only assignments whose right side is a call to a listed constructor, so parameters and other local assignments never shadow.\n\nReachability: `ndx sv analyze` with the Python pack, via the imports phase's framework call, ends up in outbound.json `confidence: \"certain\"` on a dependency whose client is a guess. Test files are dropped by SKIP_ROLES; production code with a module-level client and a same-named parameter or local hits it.\n\nOptions:\n1. (Recommended) Capture a function's parameter names and every identifier assignment target as shadows, scoped by function, and treat a shadowed name as unknown. Cost: one or two query patterns, plus a per-scope set. Risk: more captures in every Python file, so measure analyze time on home-assistant against the current tip.\n2. Only consult module-scope bindings when the call is at module level. Cost: trivial. Risk: loses the common, correct case of a module-level client used in functions."
lastModified: "2026-10-16T01:09:09.937Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
