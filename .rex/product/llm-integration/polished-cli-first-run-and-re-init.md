---
id: "fa59f28a-e444-4451-b770-f965c8db1798"
type: "capability"
title: "Polished CLI first-run and re-init experience"
slug: "polished-cli-first-run-and-re-init"
statement: "When a user runs ndx init, the CLI shows a branded n-dx header, reuses a valid existing provider configuration, and prints one unified status summary."
criteria: [{"id":"c1","text":"When ndx init runs, the CLI shall display a compact n-dx ASCII art header in ANSI color."},{"id":"c2","text":"If ANSI color is unavailable, the CLI shall display the n-dx header as plain text."},{"id":"c3","text":"The CLI shall provide the n-dx header from a shared module that other commands can reuse."},{"id":"c4","text":"When ndx init is re-run with a valid existing configuration, the CLI shall skip the provider prompt."},{"id":"c5","text":"When ndx init reuses an existing provider, the CLI shall report that provider as reused."},{"id":"c6","text":"When ndx init is run with --provider=X, the CLI shall use provider X in place of the existing configured provider."},{"id":"c7","text":"When ndx init completes on a first run or a re-run, the CLI shall print one unified status summary."},{"id":"c8","text":"While ndx init runs its sub-inits, the CLI shall keep their individual output out of the unified summary."}]
priority: "medium"
---

Branded ASCII art, smart config reuse, clean summary output on init.
