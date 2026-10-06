---
id: "54642f5c-3013-4b0c-81a4-69cc09a24791"
level: "task"
title: "Add repo identity to the analysis manifest"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "`Manifest` in `packages/sourcevision/src/schema/v1.ts` declares an optional `repo` object with `name`, `remoteUrl`, `remoteHost`, `remotePath` and `defaultBranch`."
  - "`name` is derived from the remote path when `origin` resolves and from the target directory name when it does not; a repo with no git remote still produces a populated `repo` with `remoteUrl: null`."
  - "Git remote reading lives in one helper shared with `export/iso-sources.ts` — there is no second implementation."
  - "A fixture manifest written before this change validates unchanged through `schema/validate.ts`."
  - "Unit tests under `packages/sourcevision/tests/unit/analyzers/` cover the remote-present, remote-absent and non-git-directory cases."
description: "`manifest.json` has `targetPath` but no name, remote or id, so two analyses cannot be told apart or correlated once they leave their own directory. Add `repo: { name, remoteUrl: string | null, remoteHost, remotePath, defaultBranch: string | null }` to `Manifest` in `schema/v1.ts` and populate it in `analyzers/manifest.ts`.\n\nDerive `name` from the remote path when a remote is present, falling back to the directory name. Read the git remote origin the way `export/iso-sources.ts` already does and extract one shared helper rather than writing a second reader. Leave `schemaVersion` alone unless `schema/validate.ts` requires a bump; the field is optional so analyses produced before it keep validating."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-06T22:01:02.234Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
