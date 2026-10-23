---
id: "9611c581-175a-4c59-8d3a-e265e8383745"
type: "capability"
title: "Pair-Programming Command Mode (rename from single-command)"
slug: "pair-programming-command-mode-rename"
statement: "The `ndx pair-programming` command, with the short alias `ndx bicker`, has one vendor do the primary work and then has the other vendor run the project's tests and review the result."
criteria: [{"id":"c1","text":"When a user runs `ndx pair-programming` or `ndx bicker`, the CLI shall send both commands to the same pair-programming handler."},{"id":"c2","text":"When a user runs `ndx single-command` or `ndx sc`, the CLI shall print an error saying the command was renamed to `pair-programming` / `bicker` and exit non-zero."},{"id":"c3","text":"When a user runs `ndx --help` or `ndx pair-programming --help`, the CLI shall show the `pair-programming` command name and its `bicker` alias."},{"id":"c4","text":"When the active vendor is codex, pair-programming mode shall invoke claude to run the configured test command after the primary work step completes."},{"id":"c5","text":"When the active vendor is claude, pair-programming mode shall invoke codex to run the configured test command after the primary work step completes."},{"id":"c6","text":"Pair-programming mode shall print the reviewer vendor's pass/fail verdict and summary to the terminal under a section labeled 'Reviewer (claude|codex)'."},{"id":"c7","text":"If the reviewer vendor detects test failures, pair-programming mode shall print the failures verbatim and exit non-zero."},{"id":"c8","text":"If the reviewer vendor is unavailable or not authenticated, pair-programming mode shall print a warning and continue without crashing."},{"id":"c9","text":"When a user runs `ndx pair-programming --help`, the CLI shall describe the cross-vendor review behavior and when it falls back."}]
source: "smart-add"
---

Rename the ndx single-command/sc CLI entrypoints to ndx pair-programming/bicker, and augment the mode with cross-vendor validation so whichever vendor is not doing the primary work automatically runs tests and reviews the completed command output.
