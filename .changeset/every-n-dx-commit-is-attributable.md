---
"@n-dx/core": patch
---

Attribute every commit n-dx creates.

Three commit sources omitted the `Co-Authored-By: En Dash's n-dx <n-dx@endash.us>`
trailer: `/ndx-adversarial-review`'s commit step, the dashboard deploy commit in
`export.js`, and the `chore: n-dx init` baseline commit in `git-preflight.js`.
The trailer is what routes a commit to the n-dx identity — `merge-history.ts`
parses it for the dashboard's merge graph and GitHub reads it for the
contribution graph — so those commits were invisible to both, silently.

The two source-level commits now build their message with `buildCommitMessage()`
from the new `packages/core/commit-trailers.js`, tagged `export/dashboard` and
`init/baseline`. The skill gained the same HEREDOC commit step the other
file-modifying skills use.

The root cause was documentation: SKILLS.md rule 2 showed a bare
`git commit -m "<skill>: <desc>"` with no trailers, so a skill written against
the documented rule came out wrong. Rule 2 now shows the trailer-bearing HEREDOC
as the canonical template, and the `N-DX*` namespace is documented — `N-DX:` for
what produced the commit, `N-DX-Item:` for which item, `N-DX-Status:` for what
changed. They are three keys with distinct meanings, not variants to unify.

Skills now declare `"commits": true` in the manifest, and
`tests/e2e/skill-commit-isolation.test.js` classifies on that flag instead of a
hardcoded array. Deriving the classification from body content would have made
the read-only assertion tautological; reading declared intent means a skill that
commits without declaring it fails loudly. A further assertion pins core's
trailer string byte-identical to hench's, since the orchestration tier cannot
import from packages and the string is necessarily duplicated.
