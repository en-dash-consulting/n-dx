---
id: "442fc751-4ea4-4a7f-855f-77a9e31f9a4a"
type: "change"
title: "Build the HCL grammar and recognise Terraform files"
slug: "build-the-hcl-grammar-and-recognise"
intent: "Pin tree-sitter-hcl v1.2.0 (github.com/tree-sitter-grammars/tree-sitter-hcl) in build-grammars.mjs, additively. Add a Terraform LanguageConfig for .tf, .tfvars and terragrunt.hcl, with .terraform/ skipped. Detection: include Terraform in detectLanguages when .tf files are present, never as the primary language unless no other marker matches; repositories without .tf files must produce identical output.\n\nSterling H gate (LS12, LS13, C1, C2): do not edit analyzers/infrastructure.ts or IAC_KINDS, and write nothing new to infrastructure.json or outbound.json. Terraform models stay in memory. Add a test that a fixture repository with .tf files yields the same infrastructure.json content before and after this change."
acceptanceCriteria:
  - "tree-sitter-hcl.wasm builds from v1.2.0 with a pinned checksum"
  - "Terraform files get inventory roles; .terraform/ is skipped"
  - "Repositories without .tf files produce identical analysis output"
  - "The six static root policy tests pass"
touches:
  - "8b4b34af-ec1d-4593-8266-67e39928289c"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sourcevision"
  - "pr-8"
source: "roadmap"
---
