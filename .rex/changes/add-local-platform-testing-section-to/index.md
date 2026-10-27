---
id: "11343373-2400-483d-9736-04f42cbce488"
type: "change"
title: "Add Local Platform Testing section to main README with prerequisites and run commands"
slug: "add-local-platform-testing-section-to"
intent: "Insert a 'Local Platform Testing' section in README.md (near the Platform Support table) that documents: (1) prerequisites — Docker Desktop ≥ 20, disk space for images; (2) commands to run the Windows and macOS gauntlet suites; (3) expected output and exit codes; (4) a pointer to .local_testing/README.md for advanced options. Content must be accurate and runnable from the repo root."
acceptanceCriteria:
  - "README.md contains a 'Local Platform Testing' section with Windows and macOS run commands"
  - "Prerequisites (Docker Desktop version, disk space) are explicitly listed"
  - "Commands are copy-pasteable from the repo root without modification"
  - "Section links to .local_testing/README.md for advanced options"
  - "Section accurately reflects the actual scripts and Dockerfiles present in .local_testing/"
amends: [{"target":"5a24a938-4bbe-4f27-a036-bfdf08400af8","delta":"modified","summary":"Add Local Platform Testing section to main README with prerequisites and run commands","base":"d71bdf04048d5c3d5827e3e188eb2172acd0c6b384c26214bab64bc89007510c"}]
priority: "medium"
tags:
  - "docs"
  - "readme"
  - "testing"
  - "docker"
source: "smart-add"
---
