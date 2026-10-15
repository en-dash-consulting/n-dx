---
id: "4191f655-9b6c-4527-8672-36b21879b36f"
level: "task"
title: "ndx ci gateway-imports step misses dynamic import() that domain-isolation now flags"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "v2-hardening"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "ndx ci's gateway-imports step reports a hench src file containing `await import(\"@n-dx/rex\")` outside src/prd/rex-gateway.ts as a violation"
  - "A test in the ci.js suite covers the dynamic-import case"
  - "packages/core/config.js's dynamic @n-dx/llm-client imports are still not flagged, because no gateway rule covers core"
description: "Verdict: should-fix (low). Found by the adversarial review of b6564c07 (run 265f6a24).\n\nFailure scenario: b6564c07 added hasDynamicImportOf to the gateway rules in tests/e2e/domain-isolation.test.js, so a hench file that runs `await import(\"@n-dx/rex\")` outside src/prd/rex-gateway.ts now fails that test. packages/core/ci.js checkGatewayImports (~line 917) uses runtimeImportRegex (~line 864), which matches only `import/export … from \"pkg\"`, so `ndx ci` still reports such a file as clean. packages/core/gateway-rules.json says both paths load the same rules so they enforce the gateway pattern consistently; they now disagree.\n\nReachability: today only through a future edit; no file currently does this. Covered in the repo by the vitest policy test. `ndx ci` alone, e.g. in pre-merge or another project's gate, does not catch it.\n\nOptions:\n(a) Have checkGatewayImports also match `import\\s*\\(\\s*[\"']pkg[\"']\\s*\\)` per line, the same as hasDynamicImportOf, and add a ci.js test case. Small. Recommended.\n(b) Make one helper module, shared by ci.js and the test, so the two can't drift. Bigger, and it touches the test/orchestration boundary."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T05:45:46.211Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
