---
id: "506bf2d9-72ce-4570-848c-95c464e15840"
type: "change"
title: "Write contributor prerequisites and platform-specific setup guide"
slug: "write-contributor-prerequisites-and"
intent: "Add a 'Contributing / Development Setup' section (or CONTRIBUTING.md) covering the additional tools required to build and test the monorepo: pnpm version, build commands, and any platform-specific notes (e.g. Windows requires WSL or Docker, macOS may need Xcode CLI tools for native deps). Distinguish clearly between what a user needs versus what a contributor needs."
acceptanceCriteria:
  - "A 'Development Setup' section or CONTRIBUTING.md exists and is linked from the README"
  - "Lists contributor-specific prerequisites separate from end-user prerequisites"
  - "Covers pnpm workspace bootstrap (pnpm install), build (pnpm build), and test (pnpm test) commands"
  - "Includes at least one platform-specific callout for Windows (WSL or Docker requirement) and notes any macOS-specific steps"
  - "Node version requirement for development matches the engines field and any .nvmrc added in the user prerequisites task"
touches:
  - "af74f85e-9303-4dba-9b64-97c9b645d432"
priority: "low"
tags:
  - "docs"
  - "dx"
  - "contributing"
source: "smart-add"
---
