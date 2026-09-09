---
"@n-dx/web": patch
---

Stop the ndx binary-resolution ladder tests from inheriting the developer's own
ndx install.

`cli.js` exports its path as `NDX_CLI_PATH` (and the identical `N_DX_CLI_PATH`)
to every child it spawns — and a dev-link install exports both into the
developer's shell, so `pnpm test` inherited them. The top rung of
`resolveNdxBin()` then short-circuited above every rung the
`commands route — ndx binary resolution ladder` tests meant to exercise: two
asserted against the contributor's global `cli.js`, and two more passed
vacuously. CI never sets the variables, so this was red only for humans, and
only for the dev-link contributors most likely to run the suite.

`tests/setup-cli-path-env.js` now clears both names in every vitest worker
across all packages — the same shape as the existing colour and session
setupFiles — so no test can inherit an ambient install. Tests that want an env
rung set it explicitly to a fixture path.
