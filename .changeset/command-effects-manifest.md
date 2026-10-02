---
"@n-dx/core": patch
"@n-dx/web": patch
---

Every `ndx` command now declares its effects — what it reads and writes, which phases call a model and roughly how often, what network it touches, and how long it takes. `ndx help --effects --format=json` prints the declarations, `GET /api/commands/manifest` attaches each one to its command unchanged (with the project's `layoutPaths` for expanding path tokens like `{rex}/prd_tree/`), and `docs/cli-ui-gap.md` gains a generated Command effects table (`node scripts/build-cli-ui-gap.mjs`).

The preflight banner no longer promises "no model calls" for `ndx analyze --no-llm` or `ndx plan --fast`, neither of which turns the model off; each command now names the flags that actually do. The banner and run summary also name the right paths on a `.ndx/`-layout project.
