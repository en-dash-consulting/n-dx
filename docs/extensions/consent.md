# Consent

An extension runs only after the user approves it, the same way Claude Code asks before running a project's MCP servers.

- **First run.** The first `ndx <name>` shows the package, version, source, commands and sidecar, then asks. Without a terminal to ask on, it exits 2 and names `ndx extensions enable <name>`.
- **The hub never asks.** A request for an unapproved extension's `/x/<name>/` answers 404 with the reason. Approve it from the CLI.
- **Non-interactive approval.** `ndx extensions enable <name> --yes` approves without a prompt, for CI and provisioning scripts.
- **What an approval covers.** The approval stores a hash of the `ndx.extension` block, the package version, the source and the real path of the package directory. If any of them changes, n-dx asks again, so a same-named, same-version copy installed somewhere else is not covered. Changing the extension's scripts without bumping the version does not.
- **Project-source extensions** are approved per project path. Cloning a repository never brings an approval with it, so a repo's own extensions never run unapproved.
- **Install scripts.** `ndx extensions add` installs with `--ignore-scripts`, so no package code runs before approval. Discovery itself only reads `package.json`.

Approvals live in `<ndx home>/extensions.json`, beside the discovery cache. `disable` keeps the approval, so enabling again does not ask. `remove` forgets it.

## What approval does not do

An approved extension runs as the user, with the user's own environment and file access. n-dx adds no sandbox beyond the separate process and the scoped variables ([Environment](./environment.md)). What it does guarantee is that the per-user hub token never appears in an extension's environment or forwarded requests.

Sidecar pages run on the hub origin. Their JavaScript can call the hub APIs with the browser session cookie, including mutations. Approving a sidecar grants this browser authority too; an XSS in its page can exercise it. The proxy stripping credentials does not isolate browser scripts.
