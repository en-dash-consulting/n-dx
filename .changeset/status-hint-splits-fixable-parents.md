---
"@n-dx/rex": patch
---

`rex status` no longer tells you to run `rex fix` for parents `rex fix` will not touch. The auto-completable hint now splits pending parents (which `rex fix` closes) from `in_progress` ones (an explicit claim only a human should close), so a PRD whose only auto-completable parents are `in_progress` gets the `rex update` instruction instead of a repair that reports "No issues found."
