---
"@n-dx/hench": patch
---

The `--review` reviewer now grants itself the rex MCP tools it needs to file
findings, instead of depending on the analyzed project's permission settings.

`buildAllowedTools` derives grants from the execution policy, which covers shell
and file access and names no MCP tool. Every MCP permission for a spawned
session therefore came from the analyzed project's own `.claude/settings.json` —
something hench neither owns nor can assume. Half the review pass's purpose is
"capture the rest to the PRD", so a project without the right entries produced
findings that existed only inside a report file.

`VendorSpawnOptions` gains `extraAllowedTools`, which the Claude adapter appends
to `--allowed-tools`, and the review pass passes `REX_CAPTURE_TOOLS`:
`add_item` plus the two reads needed to resolve a parent. Deliberately not
`update_task_status` — a reviewer must not be able to mark the work it is
reviewing complete.

Findings that still cannot be filed are now reported in the run output as a
distinct capture-failure warning rather than only inside the report file, so an
unattended run no longer looks like it captured everything.
