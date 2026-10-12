---
"@n-dx/core": patch
---

The three `.claude/rules` files are pointers now, so each seam registry and the
web gateway boundary have one copy — the `packages/<pkg>/AGENTS.md` section
every assistant reads — instead of two.

`tests/e2e/instruction-alignment.test.js` no longer pins the rule files against
their AGENTS.md copies row for row. It holds every file in `.claude/rules/` to
being a pointer instead, whatever the file is named: no table row, a named
`packages/<pkg>/AGENTS.md`, a title that matches a section in the file it names,
and no instruction to create another rule file. A new
`.claude/rules/rex-zone-policy.md` carrying a policy table now fails; previously
only `*-injection-seams.md` names were checked, so any other name slipped
through with content Claude Code alone could read.
