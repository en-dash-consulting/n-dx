---
"@n-dx/core": patch
---

Route `ndx start`'s port-occupant kill through the Windows-safe spawn helper.

`killPortOccupant()` in `packages/core/web.js` arrived with the local-LLM-provider merge and built four command strings by hand:

```js
execSync(`netstat -ano`, …)
execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" })
execSync(`lsof -ti tcp:${port}`, …)
execSync(`kill -9 ${pid}`, { stdio: "ignore" })
```

Unlike the earlier `claude-integration.js` and `export.js` conversions, there is no live defect here: `port` is `parseInt(flags.port, 10)` or a `typeof number`-validated config value, and both `pid` values are `parseInt` results, so no interpolation can carry `&`, `^`, `(`, `)`, `!`, or a trailing backslash into a shell command line. This is the blanket `exec`/`execSync` policy being applied to new code rather than a bug being fixed — the point of a scan-based guard is that new files do not get to opt out on the argument that their particular interpolations happen to be safe today.

`netstat`, `taskkill`, and `lsof` now go through `execFileSyncCli` from `win-spawn.js` with argv. The POSIX kill drops its subprocess entirely in favour of `process.kill(pid, "SIGKILL")` — spawning `/bin/kill` to deliver a signal to a pid already in hand added a dependency on the binary being present for nothing. Failure behaviour is unchanged: `execFileSyncCli` throws on a non-zero exit exactly as `execSync` did (`lsof -ti` exits 1 when nothing is listening), and the whole body is already wrapped in a `try`/`catch` that returns `false`.

Caught by `architecture-policy.test.js`'s scan-based shell-string guard as a semantic merge conflict — the two sides never touched the same lines, so the merge produced a tree that typechecked and passed every package test suite while violating a policy one of the branches had just added. Verified red-then-green against the guard (`packages/core/web.js — imports \`execSync\` from child_process` → 56/56 passing), with the full root suite green at 97 files.
