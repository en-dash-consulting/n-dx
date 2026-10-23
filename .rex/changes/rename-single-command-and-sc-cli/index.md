---
id: "0150c623-cefa-46e5-a3a0-51aad861311b"
type: "change"
title: "Rename single-command and sc CLI entrypoints to pair-programming and bicker"
slug: "rename-single-command-and-sc-cli"
intent: "The recently added ndx single-command (alias sc) entrypoints in the core orchestrator need to be renamed to ndx pair-programming (full name) and ndx bicker (short alias) before the feature ships. This covers the CLI registration in cli.js, all help text, any internal constant strings, and any test references. The old names should emit a clear 'renamed to pair-programming / bicker' error to guide users who cached the old names."
acceptanceCriteria:
  - "ndx pair-programming and ndx bicker both route to the same handler that single-command/sc previously wired"
  - "ndx single-command and ndx sc print a deprecation/rename error message pointing to the new names and exit non-zero"
  - "ndx --help and ndx pair-programming --help display the new command name and bicker alias"
  - "All test files referencing single-command or sc are updated to use pair-programming and bicker"
  - "No references to 'single-command' or ' sc ' as a command name remain in production code or docs"
touches:
  - "9611c581-175a-4c59-8d3a-e265e8383745"
priority: "high"
tags:
  - "cli"
  - "rename"
  - "orchestration"
source: "smart-add"
---
