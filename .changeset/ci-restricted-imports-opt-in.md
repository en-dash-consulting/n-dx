---
"@n-dx/core": patch
---

`ndx ci` lets any project opt in to restricted-import rules. Set
`ci.restrictedImports` in `.n-dx.json` to a list of
`{ "module": "node:child_process", "allow": ["src/lib/exec.ts"] }` rules: the
architecture-policy step fails on a file that imports the module outside its
allow list, naming the file, the module, the rule and how to allow it. With no
rule the step reports skipped. On the n-dx monorepo the step still enforces
`child-process-allowlist.json`, now as one instance of the same rule.

The scan covers every JS and TS module flavour (`.js .mjs .cjs .jsx .ts .mts
.cts .tsx`) and, inside a git work tree, only the files git would commit, so
gitignored build output and agent worktrees are not flagged. A `.n-dx.json` or
`.n-dx.local.json` that is not valid JSON fails the step instead of reading as
"no rule configured".
