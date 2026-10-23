---
id: "7de88f8c-5bee-4b9e-9532-7f134c7244ed"
type: "change"
title: "Smart Add Command Construction and Submission UX Fix"
slug: "smart-add-command-construction-and"
intent: "Two related regressions in the Rex Dashboard Smart Add form: (1) the CLI command is being built incorrectly, appending stale or unrelated text from the UI (e.g. a previous task title) to the `add` subcommand arguments, causing a command-not-found failure; (2) the form auto-submits on every keystroke or Enter press rather than waiting for the user to finish composing their input."
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
source: "smart-add"
---
