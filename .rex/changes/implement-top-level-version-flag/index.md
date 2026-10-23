---
id: "4a9be3cc-25d6-4429-ae79-304f10d097fb"
type: "change"
title: "Implement top-level version flag handling for ndx and n-dx"
slug: "implement-top-level-version-flag"
intent: "Add argument handling in the shared CLI entrypoint so invoking `ndx -v`, `ndx --version`, `n-dx -v`, or `n-dx --version` prints the current package version and exits successfully without triggering normal command parsing."
acceptanceCriteria:
  - "Running `ndx -v` prints a single version string and exits with status code 0"
  - "Running `ndx --version` prints the same version output as `ndx -v`"
  - "Running `n-dx -v` and `n-dx --version` behave identically to `ndx` version flags"
  - "Version flag handling works from the top-level CLI without requiring a subcommand"
  - "Invoking the version flags does not start long-running services or execute unrelated command logic"
amends: [{"target":"b3e82a63-746a-474e-af59-947d8a0f0fb9","delta":"modified","summary":"Implement top-level version flag handling for ndx and n-dx","base":"0bf93fa399182ebc9448ca87a36e45dfe80ea5822b09620c630272d441fd3295"}]
priority: "high"
tags:
  - "cli"
  - "ux"
source: "smart-add"
---
