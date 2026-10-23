---
id: "74047536-342a-4358-b2ec-33e783786b2a"
type: "change"
title: "Add regression coverage and help text for version flags"
slug: "add-regression-coverage-and-help-text"
intent: "Update automated CLI tests and user-facing help output so the new version flags remain discoverable and do not regress when command parsing changes in the future."
acceptanceCriteria:
  - "Automated tests cover both `-v` and `--version` at the top-level CLI entrypoint"
  - "Tests verify the command exits successfully and does not route into unrelated subcommand execution"
  - "CLI help output mentions `-v, --version` as supported top-level flags"
  - "The documented behavior matches the actual output format used by the CLI"
touches:
  - "b3e82a63-746a-474e-af59-947d8a0f0fb9"
priority: "medium"
tags:
  - "cli"
  - "testing"
  - "docs"
source: "smart-add"
---
