---
id: "19910eb0-3773-48ef-8243-dc790402ce5e"
level: "task"
title: "Build the sdlc-profile analyzer with its own bounded walk and CI parsing"
status: "pending"
priority: "high"
blockedBy:
  - "91327de0-d951-430d-b93b-0b8f26b69000"
source: "ndx-capture"
acceptanceCriteria:
  - "`analyzers/sdlc-profile.ts` performs its own walk; `analyzers/inventory.ts` and its `codeOnly` default are unchanged."
  - "The walk respects `.gitignore` and `.sourcevisionignore`, skips `node_modules` and vendored directories, enforces a depth cap and a file-count cap, and skips any file over 1 MB; each bound is covered by a test."
  - "CI definitions parse into classified jobs and steps for GitHub Actions, GitLab CI, CircleCI and Bitbucket; Jenkinsfile is handled heuristically."
  - "A CI file that is present but unparseable is reported as a parse failure carrying its path — never as \"no CI configured\"."
  - "`package.json` scripts, Makefile targets, pyproject and go.mod feed the `commands` section."
  - "Terraform and CloudFormation parsing reuses `export/iso-declared.ts`; no second parser is introduced."
  - "Output is canonically ordered via `util/sort.ts`; two runs over an unchanged repo produce byte-identical `sdlc-profile.json`."
  - "The analyzer is invoked from `cli/commands/analyze.ts` beside the project profile, and every `sv analyze` writes the file."
  - "With no LLM key configured the analyzer completes and makes no network call; with a key present the deterministic fields are identical to the keyless run."
description: "`analyzers/sdlc-profile.ts` needs file types the inventory deliberately throws away — the `codeOnly` filter in `analyzers/inventory.ts` defaults to true and drops YAML, JSON, TOML, Dockerfile and `.tf`. Widening the inventory to reach them would pollute zone detection, so the analyzer gets its own bounded traversal, the way `project-profile.ts` and `export/iso-declared.ts` already do.\n\nBounds: respect `.gitignore` and `.sourcevisionignore`, skip `node_modules` and vendored directories, cap depth and file count, never read a file over 1 MB.\n\nParse CI definitions into steps for GitHub Actions, GitLab CI, CircleCI and Bitbucket, with Jenkinsfile handled heuristically. Parse `package.json` scripts, Makefile targets, pyproject and go.mod for the `commands` section. Reuse `export/iso-declared.ts` for Terraform and CloudFormation rather than parsing them again.\n\nWire it into `cli/commands/analyze.ts` beside the project profile so every analyze writes the file. The deterministic path takes no LLM and no network. The existing `analyzers/enrich-judge.ts` cascade may refine genuinely ambiguous judgements such as \"does this job deploy?\" when a key is present, but the deterministic result has to stand alone and be unchanged when it is not."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-06T22:01:02.234Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
