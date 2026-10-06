---
"@n-dx/web": patch
---

Add an untracked file to `.gitignore` from the dashboard's git status panel.

The panel exists because hench's pre-run gate refuses to start an autonomous
run against a dirty tree, and the usual reason it trips is untracked noise —
build output, a scratch file, a local log — that should never have been in
git's view at all. Until now the only ways out were committing the noise or
discarding it; ignoring it meant leaving the browser.

Untracked rows now carry an **Ignore** button that appends the path to the
project's `.gitignore` via a new `POST /api/git/ignore`, and the list
refreshes in place so the next one can go too.

The route writes one anchored, literal entry per request (`/build/out.js`,
not `out.js`), escaping any glob metacharacters in the path so a file named
`report[1].txt` ignores that file rather than a character class. It creates
`.gitignore` if absent, appends cleanly to one without a trailing newline,
and skips an entry already present. Tracked and already-ignored paths are
refused with an explanation rather than written: `.gitignore` has no effect
on a path git already tracks, so writing the entry would look like it worked
and do nothing.
