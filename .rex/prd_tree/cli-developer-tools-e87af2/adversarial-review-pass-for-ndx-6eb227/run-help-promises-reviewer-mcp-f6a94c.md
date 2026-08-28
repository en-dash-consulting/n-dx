---
id: "f6a94c51-e7eb-4efc-b645-d060dd8b9e5b"
level: "task"
title: "run --help promises reviewer MCP capture grants unconditionally, but extraAllowedTools is Claude-only"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "review-pass"
  - "docs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "hench run --help qualifies the reviewer MCP tool-grant paragraph as applying to the Claude CLI vendor, and states that other vendors rely on the analyzed project's own permission settings"
  - "hench run --help states that reviewer capture additionally requires the analyzed project to have the rex MCP server registered (ndx init does this), on every vendor"
description: "Verdict: should-fix (severity low; doc drift). help.ts:87-93 states 'the reviewer gets the executor's shell and file access plus three rex MCP tools — add_item, get_item, get_prd_status' with no vendor qualifier, but VendorSpawnOptions.extraAllowedTools is honored only by the Claude CLI adapter (vendor-adapter.ts:122: 'Currently only honored by the Claude CLI adapter. Other adapters ignore it.'). A codex --review run reads help that overpromises: its reviewer's capture still depends on the analyzed project's own permission settings, and a denied capture surfaces only via the captureFailedFindings warning. Related completed work: task 120b14f2 (grant the reviewer PRD-write permission), whose criterion 'the reviewer's permitted tool surface is documented' is what this drift undercuts.\n\nReachability: any user running --review with the codex vendor who consults hench run --help.\n\nSolution: qualify the sentence in help.ts (one line) — e.g. 'Tool grants (Claude CLI): …; other vendors rely on the analyzed project's own permission settings.' No code change needed.\n\nAddition (ndx-adversarial-review, 2026-08-28): the overclaim holds even on Claude — the grant is permission-only. buildClaudeCliArgs passes no --mcp-config, so the spawned reviewer can call mcp__rex__add_item only if the analyzed project itself has a rex MCP server registered (ndx init does this; a project that skipped it has no server for the grant to act on). help.ts's claim that capture works 'without depending on the analyzed project's own permission settings' should therefore be qualified with the registration dependency too, not just the vendor. Runtime already surfaces the failure via the capture-failure warning; only the docs need the qualifier."
lastModified: "2026-08-28T16:01:50.479Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
