---
id: "25c1d40b-17d3-4dc7-8b23-e07fa789425b"
level: "task"
title: "Embed n-dx dashboard permalink for the PRD item in the commit message footer"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "commit"
  - "dashboard"
source: "smart-add"
startedAt: "2026-04-30T14:37:19.862Z"
completedAt: "2026-04-30T14:42:15.253Z"
endedAt: "2026-04-30T14:42:15.253Z"
resolutionType: "code-change"
resolutionDetail: "Added N-DX-Item trailer to commit messages pointing to PRD item dashboard view. Base URL from .n-dx.json web.publicUrl falls back to localhost:3117. Tests verify configured and fallback URL behavior."
acceptanceCriteria:
  - "Each hench commit message contains an `N-DX-Item:` trailer with a fully-qualified URL pointing to the PRD item view"
  - "URL base is configurable via `.n-dx.json` (`web.publicUrl`) and falls back to the local `ndx start` URL when unset"
  - "When `web.publicUrl` is misconfigured or unreachable, the trailer is still emitted and a warning is logged — the commit is not blocked"
  - "Permalink format is documented in CLAUDE.md and the rex package README"
description: "Add a permalink trailer (e.g. `N-DX-Item: http://localhost:3117/#/rex/item/<id>` or a configured public dashboard base URL) pointing to the PRD item the commit advances. The base URL is resolved from `.n-dx.json` (`web.publicUrl` falling back to the local server URL). When rendered on GitHub the URL is clickable and lets reviewers jump to the PRD context."
---
