---
id: "ca9e532a-3383-4ae3-9639-99d824d393cb"
level: "task"
title: "Document Node.js and pnpm version prerequisites for end users"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "dx"
source: "smart-add"
startedAt: "2026-04-19T04:40:31.296Z"
completedAt: "2026-04-19T04:42:32.849Z"
resolutionType: "code-change"
resolutionDetail: "Added Node.js ≥18/pnpm ≥10 prerequisites to README Quick Start, docs/guide/getting-started.md, and docs/guide/quickstart.md; fixed npm→pnpm in quickstart.md; added pnpm to engines in root and core package.json; added .nvmrc with 22."
acceptanceCriteria:
  - "README Quick Start lists minimum Node.js version (e.g. '>=20') and minimum pnpm version"
  - "package.json engines field in @n-dx/core matches the documented requirement"
  - "If a .nvmrc or .node-version file is appropriate, it is added to the repo root"
  - "Docs do not reference npm as the install mechanism if pnpm is required (or clarify the distinction)"
description: "Identify the minimum Node.js and pnpm versions required for end users (not contributors) and add them to the README Quick Start and any relevant docs pages. Cross-reference package.json engines fields if present, or add them if missing, so tooling like volta/nvm can auto-select the right version."
---
