---
"@n-dx/web": patch
---

Start a new project from the hub.

The hub's chooser listed the repositories `ndx start` had registered and gave
no way to add one — a new project meant leaving the browser, making a folder,
and running the CLI there. It now has a **New project** button: a folder name,
the directory to put it in, and the exact absolute path it will create, checked
against the filesystem as you type.

That preview is the point. `GET /api/hub/new-project` resolves the path
server-side and says whether it can be created, so `..`, a relative parent and
a `~` all display as what they actually are, and the refusals arrive before
anything is written: a parent that does not exist, a name that is really a path,
a folder that already has content (pointed at `ndx start` instead). An existing
*empty* folder is adopted, and says so.

`POST /api/hub/projects/new` re-plans rather than trusting the client, creates
the folder, registers it with the hub's own n-dx binary, and answers with its
URL — the setup wizard an uninitialized project already serves, which is where
assistants, the LLM vendor and the git repository get decided. One path into
init, the one that already works. The button is busy, with a spinner and the
path it is creating, for the seconds the folder and its server take.

A hub-created folder also gets the `.n-dx-web.pid` / `.n-dx-web.port` markers
`ndx start` would have left, so `ndx start status` and `ndx start stop` work in
it like any other registered project.
