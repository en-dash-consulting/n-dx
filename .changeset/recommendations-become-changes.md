---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

`rex recommend --accept` and `rex analyze --accept` now serve a v2 PRD, creating a change per proposal instead of refusing. A v2 tree has no container above a change, so the proposal hierarchy does not cross: only the deepest node that names work becomes a change — a feature's tasks, or the feature when it proposed none, or the epic when it proposed no features. The run's epic and its zone+category features are not created.

Each change goes through the same `rex add` door, so it lands in the Inbox needing placement and the rules rank the capability or constraint it amends or touches, printed with the `rex change place` line that records it. That is sourcevision's one door into the product map.

The baseline a v1 accept writes — the items a scanner marks completed because the code already does them — is not written on v2. That is the product layer, which `rex migrate-plan` establishes and a change amends; `analyze` reports how many proposals it skipped for that reason rather than opening them as pending work nobody will do.

Sourcevision's pull-request markdown no longer reads `.rex/prd.md` or `.rex/prd.json`. The epic resolver parsed them itself and fell back from one to the other; both are legacy formats a folder-tree or v2 project does not have, and the read was wrapped in a `catch` returning "no PRD", so it reported an empty Completed Work section rather than failing. It now reads the PRD through the same `rex tree --format=json` spawn the branch work collector uses.
