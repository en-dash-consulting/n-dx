---
"@n-dx/core": patch
---

Fix the skill-authoring reference telling authors to write the one commit step
CI rejects, and pin the shipped-vs-source difference instead of arguing about it.

`SKILLS.md` documented the required commit step as
`git commit -m "$(cat <<'EOF' … EOF)"`. `skill-portability.test.js` forbids
exactly that construction in skill bodies — heredocs and `$(...)` are POSIX-only,
and Git Bash is not part of Windows, so the step fails on a stock PowerShell at
the *last* action of a skill, after all the real work is done. Following the
documentation produced a skill that failed CI, and nothing could notice because
the guard only read skill bodies, never the reference they are written from. The
reference now teaches the file-based form the skills already use
(`git commit -F`), and the guard covers it.

`.claude/skills/<name>/SKILL.md` is generated as YAML frontmatter followed by the
canonical body verbatim, so its line count runs about six higher than
`assistant-assets/skills/<name>.md`. That gap has been read as drift; it is not.
It is now asserted rather than assumed: the generated body must be byte-identical
to the canonical source, and the frontmatter may carry only `name`,
`description`, and `argument-hint`.

That check closes a real gap. `assistant-body-drift.test.js` compares the
committed artifact against what the generator produces today, so the two always
agree — including when the generator is what is wrong. A renderer that dropped or
reordered a section would have kept every suite green while shipping a skill that
no longer matched the file its authors edit.
