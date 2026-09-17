---
"@n-dx/core": patch
"@n-dx/web": patch
---

Add `ndx which [dir]` — report which copy of n-dx is actually running.

The package version is the same string in every checkout and every install, so `ndx --version` cannot distinguish a globally installed `ndx` from the worktree you are standing in. `ndx which` prints five fields instead: the version, the absolute path of the `cli.js` executing, the install kind (npm registry install, pnpm global link, or workspace checkout), the branch and short SHA of the install checkout when it is a git working tree, and the resolved project directory. `--json` emits the same record as one object, and `ndx --version --verbose` prints the identical report.

Install kind distinguishes a globally linked checkout from one invoked directly by comparing `process.argv[1]` against the realpathed entry point — Node leaves the former as the symlink, so a global bin shim makes the two disagree. The command always exits 0: a missing `git`, or an install that is not a working tree, reports no git identity rather than failing.

`which` is registered in `ndx --help`, has its own `ndx which --help` page, and appears in the dashboard's All Commands view under Setup — ungated, since identifying the CLI is most useful on a project that is not initialized yet.
