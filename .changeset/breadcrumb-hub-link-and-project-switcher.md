---
"@n-dx/web": patch
---

Dashboard breadcrumb links back to the hub and switches between registered projects.

Behind the hub, the breadcrumb now starts with a "Hub" link to `/hub`. With two or more projects registered, the project name opens a keyboard-operable menu of every project with a status dot, the current one marked; choosing one opens the same view under `/p/<id>/`. The list is re-read each time the menu opens. With one project the name stays plain text, and without a hub (standalone `web serve`, a static export) there is no Hub link. Whether a hub is present is asked of `GET /api/hub/projects` rather than inferred from the URL, since a single registered project is served at the root alias.
