---
id: "5c42b825-13a4-471c-9f3a-4cd8078f9353"
level: "feature"
title: "Layout resolver"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "layout-resolver"
source: "caos work management: feature ndx 0.8.0 - Layout resolver"
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path exists outside the resolver and the migration command (policy test)."
  - "A fresh ndx init produces .ndx/ and .mcp.json only."
  - "ndx migrate-layout on this repository yields a commit that is renames plus two dotfiles; rex validate, ndx status and the dashboard cache are identical before and after; a second run is a no-op."
  - "A project on the legacy layout runs every command unchanged with no warning."
  - "Every package's test suite passes on both layouts."
description: "n-dx keeps its files in three root folders (.rex, .hench, .sourcevision), five loose .n-dx* files and, since 0.7.0, ~/.n-dx for the hub; roughly 380 source files name those paths directly. Introduce one layout resolver in core and a paths module per package so no code names a folder directly, with an architecture-policy rule against new literals. The resolver reads a .ndx/ folder first and falls back to the legacy layout silently. ndx init writes .ndx/ for new projects. ndx migrate-layout moves an existing project when the operator chooses: snapshot, git mv the tracked paths so history follows, move the untracked state, rewrite the .gitignore and .gitattributes blocks, verify, or restore. The per-user directory becomes ~/.ndx/ with NDX_HOME, reading ~/.n-dx/ and N_DX_HOME as fallbacks. .mcp.json stays at the repository root because the vendor CLIs read it there; task claims stay in the git common directory.\n\nGoal: The folder layout is one decision in one module, new projects start on the target layout, and existing projects can move when they choose."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a layout resolver in core and a paths module per package that read .ndx/ first and fall back to the legacy layout](./add-a-layout-resolver-in-core-and-a.md) | completed |
| [Add ndx migrate-layout to move an existing project to .ndx/](./add-ndx-migrate-layout-to-move-an.md) | completed |
| [Make ndx init write the .ndx/ layout for new projects](./make-ndx-init-write-the-ndx-layout-for.md) | completed |
| [Move the per-user directory to ~/.ndx/ with NDX_HOME, reading ~/.n-dx/ and N_DX_HOME as fallbacks](./move-the-per-user-directory-to-ndx.md) | completed |
| [Route hench and web file access through their paths modules](./route-hench-and-web-file-access.md) | completed |
| [Route rex and sourcevision file access through their paths modules](./route-rex-and-sourcevision-file-access.md) | completed |
