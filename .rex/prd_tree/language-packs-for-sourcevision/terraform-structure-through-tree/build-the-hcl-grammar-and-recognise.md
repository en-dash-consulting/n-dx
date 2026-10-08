---
id: "442fc751-4ea4-4a7f-855f-77a9e31f9a4a"
level: "task"
title: "Build the HCL grammar and recognise Terraform files"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sourcevision"
  - "pr-8"
source: "roadmap"
acceptanceCriteria:
  - "tree-sitter-hcl.wasm builds from v1.2.0 with a pinned checksum"
  - "Terraform files get inventory roles; .terraform/ is skipped"
  - "Repositories without .tf files produce identical analysis output"
  - "The six static root policy tests pass"
description: "Pin tree-sitter-hcl v1.2.0 (github.com/tree-sitter-grammars/tree-sitter-hcl) in build-grammars.mjs, additively. Add a Terraform LanguageConfig for .tf, .tfvars and terragrunt.hcl, with .terraform/ skipped. Detection: include Terraform in detectLanguages when .tf files are present, never as the primary language unless no other marker matches; repositories without .tf files must produce identical output."
lastModified: "2026-10-08T03:09:08.749Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
