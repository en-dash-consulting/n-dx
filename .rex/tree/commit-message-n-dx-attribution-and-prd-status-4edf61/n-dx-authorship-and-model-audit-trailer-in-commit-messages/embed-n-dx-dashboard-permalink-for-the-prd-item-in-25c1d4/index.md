---
id: "25c1d40b-17d3-4dc7-8b23-e07fa789425b"
level: task
title: "Embed n-dx dashboard permalink for the PRD item in the commit message footer"
status: pending
priority: medium
tags:
  - "hench"
  - "commit"
  - "dashboard"
source: "smart-add"
acceptanceCriteria:
  - "Each hench commit message contains an `N-DX-Item:` trailer with a fully-qualified URL pointing to the PRD item view"
  - "URL base is configurable via `.n-dx.json` (`web.publicUrl`) and falls back to the local `ndx start` URL when unset"
  - "When `web.publicUrl` is misconfigured or unreachable, the trailer is still emitted and a warning is logged — the commit is not blocked"
  - "Permalink format is documented in CLAUDE.md and the rex package README"
description: "Add a permalink trailer (e.g. `N-DX-Item: http://localhost:3117/#/rex/item/<id>` or a configured public dashboard base URL) pointing to the PRD item the commit advances. The base URL is resolved from `.n-dx.json` (`web.publicUrl` falling back to the local server URL). When rendered on GitHub the URL is clickable and lets reviewers jump to the PRD context."
---

# Embed n-dx dashboard permalink for the PRD item in the commit message footer

🟡 [pending]

## Summary

Add a permalink trailer (e.g. `N-DX-Item: http://localhost:3117/#/rex/item/<id>` or a configured public dashboard base URL) pointing to the PRD item the commit advances. The base URL is resolved from `.n-dx.json` (`web.publicUrl` falling back to the local server URL). When rendered on GitHub the URL is clickable and lets reviewers jump to the PRD context.

## Info

- **Status:** pending
- **Priority:** medium
- **Tags:** hench, commit, dashboard
- **Level:** task
