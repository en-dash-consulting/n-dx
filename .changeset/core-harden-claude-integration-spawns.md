---
"@n-dx/core": patch
---

Route `ndx init`'s Claude CLI invocations through the Windows-safe spawn helper.

`packages/core/claude-integration.js` built six `execSync` command strings by hand — the MCP `remove`/`add` registration pair and four `--version` discovery probes. Every argument involved is a filesystem path (the claude binary, the resolved MCP entrypoint, the project directory), and the surrounding quoting was a bare `"`:

```js
execSync(`"${claudeCmd}" mcp add ${name} -- node "${bin}" ${descriptor.mcpCommand} "${absDir}"`)
```

A project directory ending in a backslash — `C:\Users\Tom&Jerry\my proj (v2)\` — produces `..."C:\Users\Tom&Jerry\my proj (v2)\"`, where the trailing backslash escapes its own closing quote. Argument parsing corrupts from that point on, and the command can still exit 0, so `ndx init` reports "registered" having stored a truncated command. All six now use `execFileSyncCli` from `win-spawn.js`, which applies the `quoteWindowsToken`/ArgvQuote rules and logs each invocation itself.

Verified against that exact path: the argv form emits `"...(v2)\\"` with the backslash doubled, keeps every `&` inside a quoted token, and round-trips 9 argv entries to 9 command-line tokens.

The unquoted interpolations in the old strings (`${scope}`, `${name}`, `${descriptor.mcpCommand}`) were manifest-derived constants rather than user input, so this was a correctness bug on unusual-but-legal paths, not a user-input injection vector.

**The guard that should have caught it is now scan-based.** `architecture-policy.test.js` walked a hardcoded 12-file `DEP0190_SCOPE`, so it only ratcheted over files someone remembered to enumerate — which is exactly how `claude-integration.js` and `export.js` kept hand-built command lines through an entire Windows-hardening epic. It now scans the whole production tree for:

- imports of `exec`/`execSync` from `child_process` (the string-command APIs — `execFile`/`execFileSync`/`spawn` take argv and are fine)
- `shell: process.platform`
- `shell: true` with non-empty args

Exemptions moved into a `SHELL_STRING_EXEMPT` map where each entry states its reason, with the previously-undocumented `ci.js` and `pr-check.js` pnpm cases now recorded explicitly and `export.js` naming the task that will retire it. Demonstrated red-then-green against a newly added unhardened file, with no edit to the guard required to catch it.

`claude-integration.js` was also dropped from the `child_process` import allowlists in `architecture-policy.test.js` and `ci.js` — it no longer imports any `child_process` API, so the permission was removed rather than left permitted-but-unused.
