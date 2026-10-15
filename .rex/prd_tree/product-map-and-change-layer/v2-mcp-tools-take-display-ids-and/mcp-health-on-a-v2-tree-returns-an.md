---
id: "d090cf0a-f41c-4cd5-90c1-d0b774c10e31"
level: "task"
title: "MCP health on a v2 tree returns an error instead of the score when package.json is malformed"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "v2-hardening"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 tree with a malformed package.json, MCP health still returns overall and dimensions (integration test)"
  - "CLI rex health on the same tree does not crash on the malformed package.json"
description: "Verdict: should-fix (introduced by 4dad9dc0). The v2 report readPackageVersion (packages/rex/src/cli/v2-health.ts) JSON.parses the project's package.json and rethrows on a parse error. handleHealth (packages/rex/src/cli/mcp-tools/health.ts) runs computeV2Health inside the same try as the v1 score, so on a v2 tree whose package.json is malformed (a partial edit, say) the MCP health tool answers \"Error: ...\" and drops overall/dimensions, which it returned before this change. CLI rex health throws the same way, but that predates this change. Reachable: the MCP health tool on any v2 project with an invalid package.json. Options: (a) readPackageVersion treats invalid JSON as no version (cheap; changes CLI too, so the title-release-token rule simply skips); (b) in the MCP handler, put a v2 failure into the v2 field as {error} and keep the score (more code, MCP-only). Recommend (a)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:31:55.761Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
