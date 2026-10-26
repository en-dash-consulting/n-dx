---
"@n-dx/web": patch
"@n-dx/core": patch
---

Add the versioned hub extension API. `GET /api/hub/extensions[?project=<id>]` lists installed extensions with their manifest, state, compatibility and sidecar state. Given a project, it also returns that project's dashboard links. `POST /api/hub/extensions/:name/stop` stops a sidecar. These two endpoints, plus `GET` and `POST /api/hub/projects`, are now stable under `apiVersion` 1, and every answer carries `apiVersion`. `ndx extensions list --json` now includes each extension's `manifest`.
