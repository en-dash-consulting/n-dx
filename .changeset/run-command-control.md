---
"@n-dx/web": patch
---

The dashboard can start the project's dev server or a build, and hands you the link when it serves.

A new control in the bottom bar appears when `npm run dev`, `python3 main.py`, `cargo run`, `go run .`, a Makefile target or similar is detected from the project's own manifests — using the package manager the lockfile implies, not an assumed one. A dropdown lists every detected run and build command, a spinner runs while the command does, and the result reports success, failure or a stop.

When the process announces a localhost URL the port is read from what it actually printed — dev servers choose a port at runtime and move when one is busy — and surfaced as a link. A wildcard bind is shown as localhost, which is what a browser on the machine can open.

Commands are run by id from the server's own detected list, and that is the only thing the route accepts — no binary, and no extra arguments. Without a shell an argument is only ever one literal argv entry, which is true and beside the point: flags are the attack surface, and `make --eval` or `cargo --config build.rustc-wrapper` execute an arbitrary program on their own. The package manager is likewise taken from an allowlist rather than from the repo's `packageManager` field, which is untrusted checkout content. Spawning goes through `spawnCli` so Windows `.cmd` shims launch correctly, and Stop tree-kills, which is what reaches a dev server running underneath a shim instead of orphaning it with the port still held.

A run has no timeout, because a dev server is supposed to stay up; a build gets a ten-minute ceiling. One command runs at a time per workspace, and the dashboard's shutdown sequence terminates anything still running so a dev server is not orphaned with its port held.
