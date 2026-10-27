---
id: "ca9e532a-3383-4ae3-9639-99d824d393cb"
type: "change"
title: "Document Node.js and pnpm version prerequisites for end users"
slug: "document-node-js-and-pnpm-version"
intent: "Identify the minimum Node.js and pnpm versions required for end users (not contributors) and add them to the README Quick Start and any relevant docs pages. Cross-reference package.json engines fields if present, or add them if missing, so tooling like volta/nvm can auto-select the right version."
acceptanceCriteria:
  - "README Quick Start lists minimum Node.js version (e.g. '>=20') and minimum pnpm version"
  - "package.json engines field in @n-dx/core matches the documented requirement"
  - "If a .nvmrc or .node-version file is appropriate, it is added to the repo root"
  - "Docs do not reference npm as the install mechanism if pnpm is required (or clarify the distinction)"
touches:
  - "087ff59e-ba8c-4be6-a975-a5c170362498"
priority: "medium"
tags:
  - "docs"
  - "dx"
source: "smart-add"
---
