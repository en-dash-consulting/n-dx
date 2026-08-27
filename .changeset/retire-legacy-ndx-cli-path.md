---
"@n-dx/web": patch
"@n-dx/core": patch
---

Fix the ndx binary resolution ladder ignoring an analyzed project's own install.

`resolveNdxBin` consulted an undocumented `NDX_CLI_PATH` ahead of every rung in
its own documented ladder, and without the existence check every other rung
performs. `cli.js` set that variable — a differently-spelled twin of the
documented `N_DX_CLI_PATH`, assigned the same value eight lines apart — and
exported it to every child process.

The effect: any web server started by `ndx start` silently ran the *launching*
install's `cli.js` rather than the analyzed project's pinned
`node_modules/.bin/ndx`, and a stale value produced a guaranteed spawn failure
instead of falling through.

Both the read and the assignment are removed, so the ladder now behaves as
documented: project-local bin, then `N_DX_CLI_PATH`, then the module graph,
then the monorepo dogfood path.

This also fixes two `routes-commands` tests that were red only when the suite
ran inside an `ndx work` session, which is how the variable was inherited. The
fixture now clears both variables so ambient environment cannot decide what the
ladder sees.
