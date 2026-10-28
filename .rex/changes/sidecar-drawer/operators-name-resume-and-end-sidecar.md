---
id: "eed38806-62c2-4dbc-8d1c-791aa350c0be"
type: "task"
title: "Operators name, resume and end Sidecar sessions from a sessions list"
slug: "operators-name-resume-and-end-sidecar"
description: "Story 10, UI only: rename uses the PATCH route from the session-target task; branches come from /api/workspaces; other worktrees are read through /w/<key>/api/sidecar/sessions. Mock: Drawer states C board. CAOS story: https://www.notion.so/3f7a80b719248161bde1f381bd30e8ee."
acceptanceCriteria:
  - "Rows show name, branch, lens, vendor and model, turns, cost and waiting cards; the branch comes from /api/workspaces, never a git spawn (tested)"
  - "Resume opens the session, Rename uses PATCH /api/sidecar/sessions/:id, and End asks for confirmation before calling the end route (tested)"
  - "An ended session links to its transcript, read-only (tested)"
  - "The All worktrees filter lists other worktrees sessions read-only, and only this worktree sessions offer Resume, Rename and End (tested)"
priority: "medium"
source: "caos"
---
