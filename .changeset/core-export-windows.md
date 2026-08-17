---
"@n-dx/core": patch
---

Make `ndx export` work on Windows.

`ndx export --deploy=github` could not succeed on Windows. Two independent blockers, both now fixed and both verified end-to-end.

**1. The dynamic import aborted the command immediately.** `export.js` did `await import(resolvePackagePath(...))` with a bare absolute path, and Node's ESM loader rejects that on Windows:

```
ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'
```

The command died before doing any work — before generating the dashboard, let alone deploying. Now wrapped in `pathToFileURL(...).href`, the same fix `tests/e2e/published-package-loadability.test.js` already applies for this exact error. This was not in the original bug report; it surfaced only when the flow was actually run on Windows.

**2. POSIX-only shell commands in the deploy path.**

- `rm -rf "<path>"` per worktree entry. `rm` is not a cmd.exe command, and although Git for Windows ships `usr/bin/rm.exe` it is not normally on PATH. With no try/catch this threw and aborted the deploy. Replaced with `rmSync(path, { recursive: true, force: true })` — no shell at all, and `force: true` carries the `-f` intent.
- `git rm -rf . 2>/dev/null || true`. Both `2>/dev/null` and `|| true` are POSIX sh constructs. The tolerate-failure intent moved into a JS `try/catch`, which is also clearer about *why* it is tolerated: a fresh orphan branch legitimately has nothing to remove.

**All 16 remaining `execSync` command strings converted to argv** via `execFileSyncCli` from `win-spawn.js`. The interpolated ones hand-quoted paths (`tmpWorktree`, `dir`) that break on Windows when a project path ends in a backslash — the trailing backslash escapes its own closing quote — or contains `&`/`^`. `rex` also needs the `.cmd` shim handling that helper provides.

Worth stating precisely: the unquoted `${branch}` interpolations were **not** an injection vector, because `branch` is the hardcoded constant `"n-dx-dashboard"`. The genuine risk was the project-derived paths.

`export.js` is no longer exempt from the shell-string architecture guard; that exemption was retired rather than left standing.

Verified against a scratch repository with a **local bare `origin`**, from a project directory named `e & p (v2)` — a space, an `&`, and parentheses. Both deploy routes pass: the orphan-branch creation path on first run, and the existing-branch `worktree add` path on the second. 28 files pushed, no `.ndx-deploy-tmp` left behind. No real deploy target was ever contacted.
