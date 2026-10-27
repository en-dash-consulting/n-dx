---
id: "af74f85e-9303-4dba-9b64-97c9b645d432"
type: "capability"
title: "Developer Environment Prerequisites Documentation"
slug: "developer-environment-prerequisites"
statement: "The repository documents what contributors need to build and test the monorepo, apart from what end users need, including the pnpm workspace commands and setup notes for specific platforms."
criteria: [{"id":"c1","text":"The README shall link to a Development Setup section or a CONTRIBUTING.md file."},{"id":"c2","text":"The development setup documentation shall list the prerequisites for contributors separately from the prerequisites for end users."},{"id":"c3","text":"The development setup documentation shall give the pnpm install command that bootstraps the workspace."},{"id":"c4","text":"The development setup documentation shall give the pnpm build command that builds the monorepo."},{"id":"c5","text":"The development setup documentation shall give the pnpm test command that tests the monorepo."},{"id":"c6","text":"The development setup documentation shall state that Windows contributors need WSL or Docker."},{"id":"c7","text":"The development setup documentation shall note any setup steps specific to macOS."},{"id":"c8","text":"The development setup documentation shall state a Node version for development that matches the engines field and any .nvmrc file."}]
source: "smart-add"
---

Document what contributors need beyond the end-user prerequisites — build toolchain, pnpm workspace setup, and any platform-specific gotchas — so new contributors can get a working dev environment without trial and error.

## History

- 2026-10-23 editorial: statement edited
