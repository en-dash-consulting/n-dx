---
id: "2ad53ca7-841a-4c3e-861a-d7f0eb6301d5"
type: "capability"
title: "Rex Task and Epic Deletion Functionality"
slug: "rex-task-and-epic-deletion-functionality"
statement: "Rex lets a user delete tasks and epics through a server-side deletion API and from the web UI task tab after confirming the deletion."
criteria: [{"id":"c1","text":"The server shall provide an API endpoint that deletes a Rex task or epic."},{"id":"c2","text":"The Rex web UI task tab shall offer an interactive control to delete a task or epic."},{"id":"c3","text":"When a user starts a deletion from the Rex web UI task tab, the web UI shall ask the user to confirm before it deletes the item."}]
source: "smart-add"
---
