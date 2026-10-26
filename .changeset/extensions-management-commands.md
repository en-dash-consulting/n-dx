---
"@n-dx/core": patch
---

Add `ndx extensions list | add | remove | enable | disable | info | doctor`. `add` installs into `<ndx home>/extensions` with npm and install scripts off, never into a project. `enable` shows what is being approved and asks (`--yes` approves without a prompt); the approval is tied to the package version and a hash of its manifest, and a project's extensions are approved per project path. `disable` keeps the approval. `remove --purge` also deletes the extension's state folder. `list --json` gives each extension's state (enabled, disabled, unapproved, incompatible, invalid, conflict) and reason. `doctor` prints one line per problem with its fix and exits 1 when there is any. Extension commands do not run from `ndx` yet; dispatch comes next.
