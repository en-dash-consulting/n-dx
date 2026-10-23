---
id: "54642f5c-3013-4b0c-81a4-69cc09a24791"
type: "change"
title: "Add repo identity to the analysis manifest"
slug: "add-repo-identity-to-the-analysis"
intent: "`manifest.json` has `targetPath` but no name, remote or id, so two analyses cannot be told apart or correlated once they leave their own directory. Add `repo: { name, remoteUrl: string | null, remoteHost, remotePath, defaultBranch: string | null }` to `Manifest` in `schema/v1.ts` and populate it in `analyzers/manifest.ts`.\n\nDerive `name` from the remote path when a remote is present, falling back to the directory name. Read the git remote origin the way `export/iso-sources.ts` already does and extract one shared helper rather than writing a second reader. Leave `schemaVersion` alone unless `schema/validate.ts` requires a bump; the field is optional so analyses produced before it keep validating."
acceptanceCriteria:
  - "`Manifest` in `packages/sourcevision/src/schema/v1.ts` declares an optional `repo` object with `name`, `remoteUrl`, `remoteHost`, `remotePath` and `defaultBranch`."
  - "`name` is derived from the remote path when `origin` resolves and from the target directory name when it does not; a repo with no git remote still produces a populated `repo` with `remoteUrl: null`."
  - "Git remote reading lives in one helper shared with `export/iso-sources.ts` — there is no second implementation."
  - "A fixture manifest written before this change validates unchanged through `schema/validate.ts`."
  - "Unit tests under `packages/sourcevision/tests/unit/analyzers/` cover the remote-present, remote-absent and non-git-directory cases."
amends: [{"target":"b9d3a37a-9227-4a10-87ba-de286cec7fac","delta":"modified","summary":"Add repo identity to the analysis manifest","base":"73c2b5c729d04a72777a0649d1fe3bf9259af887764d59858bbff2025a970b58"}]
priority: "high"
source: "ndx-capture"
---
