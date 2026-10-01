---
"@n-dx/core": patch
"@n-dx/web": patch
---

Initialize a blank folder — including its git repository — from the dashboard.

`ndx start` in an empty folder already served the setup page with an
**Initialize project** button, but the init it ran could never create a git
repository: the preflight prompt that offers one needs a TTY, and the wizard
spawns `ndx init` with piped stdio. A folder set up that way stayed outside
version control, with auto-commit, pair programming, and the hench run loop
silently disabled.

`ndx init` now takes `--git` / `--no-git`, which answer that prompt ahead of
time — the only way a run without a TTY can create a repository. `--git` also
gets the `chore: n-dx init` baseline commit the interactive path makes, so the
working tree is clean straight out of init.

The setup wizard asks the question in the browser instead. A new
`GET /api/commands/init/preflight` reports whether the folder is already a
repository and whether `git` is on PATH; the question appears only when there
is something to decide, is disabled with an explanation when git is missing,
and travels to `POST /api/commands/init` as `git: boolean`. The init status
endpoint reports `gitRequested` / `gitInitialized`, confirmed from disk rather
than from the exit code — `ndx init` treats a failed `git init` as a warning
and still exits 0.

The wizard also addresses the project through its hub prefix now. Plain `ndx
start` registers with the per-user hub, which serves each project at
`/p/<id>/`; the page's root-relative `fetch("/api/...")` calls reached the hub
instead, which answers 409 once a second project is registered.
