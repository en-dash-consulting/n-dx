---
id: "1afdec20-5596-4155-acf7-0f19d92ebc0b"
type: "change"
title: "Commit the files ndx init generates so work can start on a clean tree"
slug: "commit-the-files-ndx-init-generates-so"
intent: "`ndx init` writes config and tool files (`.n-dx.json`, the rex directory, `.sourcevision/`, `.hench/config.json`, `.gitignore` additions, `.mcp.json`, `AGENTS.md`/`CLAUDE.md`, README or README.proposed.md, …) and leaves them uncommitted. The first `ndx work` then finds a dirty tree and stops with an error, so a freshly initialized project cannot start work without a manual commit. Init should finish by committing exactly the paths it created or changed, with the n-dx authorship trailers — from the CLI and from the hub card's Initialize action alike."
acceptanceCriteria:
  - "After a successful `ndx init` in a git repository, the files init created or modified are committed in a single commit carrying the n-dx authorship/model trailers, and `git status` shows no init-generated paths"
  - "Only paths init wrote are staged and committed; the user's pre-existing staged or unstaged changes stay out of the commit and are left as they were"
  - "`ndx work` (and `--auto`) run immediately after init on an otherwise clean repository does not fail with an uncommitted-changes error"
  - "Re-running `ndx init` when nothing changed creates no empty commit"
  - "A flag (e.g. `--no-commit`) skips the commit; with no git repository or no configured git identity, init does not fail but prints a clear message that the files were left uncommitted"
  - "Initialize from the web hub card produces the same commit as the CLI"
  - "Tests cover: commit created, only init paths staged, pre-existing user changes preserved, no-op re-init, and `--no-commit`"
amends: [{"target":"ba9504c3-a0c7-4034-838c-2f5bf78ba904","delta":"modified","summary":"ndx init commits the files it generates","proposed":"When `ndx init` runs in a directory outside a git repository, it explains that n-dx relies on git for automatic commits and offers to run `git init` and make an initial baseline commit before init continues. When init finishes inside a git repository, it commits the files it created or changed — and only those — with the n-dx authorship trailers, so the first `ndx work` starts on a clean tree.","base":"9fd81c181f10d398ce2d1df83db57e87eba0680ba678d209cca3135cbdab1bf4"}]
priority: "high"
source: "ndx-capture"
---
