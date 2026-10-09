---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Report repo identity and scan counts on `GET /api/status`, and name the repository on each hub card.

The sv section of the status response gains `repo` (the analysis manifest's repo identity), counts for `outbound` and `infrastructure`, and `readiness` — an explicit `null` until the SDLC readiness scorer exists, so the field is part of the contract now rather than a second response shape later. Every field is present on an unanalysed project, carrying null or zero instead of being absent.

The hub's `ProjectCard` carries `repoName` and `remoteHost`, and the home page shows them under each card's title. A project's registered name is the worktree's; the repo name is the repository's, so two worktrees of one repository now read as what they are. The hub still makes no direct read of any `.sourcevision/` path — all of this arrives through the child's HTTP API.

`RepoIdentity`, `InfrastructureData` and its members are exported from `@n-dx/sourcevision` and re-exported through web's `domain-gateway.ts`.
