---
"@n-dx/core": minor
"@n-dx/hench": minor
"@n-dx/llm-client": minor
"@n-dx/rex": minor
"@n-dx/sourcevision": minor
"@n-dx/web": minor
---

0.8.0 — Find your way

Every other changeset in this release is a `patch`, which is the repo default and
correct for each change on its own. Left alone they compute to 0.7.3, and this
release is 0.8.0: a new folder layout with a resolver and per-package paths
modules, `ndx migrate-layout`, a reorganised dashboard with redirects for every
moved route, per-vendor agent models, and a preflight banner and run summary on
the interactive commands.

This changeset exists to make the aggregate a minor. It is the deliberate
exception to the "default to patch" rule in CLAUDE.md, which defers to an
explicit instruction — here the 0.8.0 epic's own acceptance criterion, that
`changeset status` computes to a minor.
