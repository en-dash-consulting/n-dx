---
"@n-dx/core": minor
"@n-dx/hench": minor
"@n-dx/llm-client": minor
"@n-dx/rex": minor
"@n-dx/sourcevision": minor
"@n-dx/web": minor
---

0.8.0 — Find your way

A single `.ndx/` directory for project state, with `ndx migrate-layout` to move
an existing project onto it. A reorganised dashboard: views are stages, Analysis
opens on the codebase map, settings are three pages (Robot Wrangler, Workflow,
Project) on a shared save frame, and every moved path redirects. A Live tab for
watching every run across a repository's worktrees. A per-user token on the hub
and dashboard, and repository trust gating what a checkout's execution config
may widen. New Claude model defaults, per-vendor agent models, per-field
resolution of the legacy `claude.*` keys, and effects declared for every command
and shown in a preflight banner.

Every other changeset in this release is a `patch`, which is the repo default
and correct for each change on its own. This one makes the aggregate a minor, as
the 0.8.0 epic requires.
