/**
 * Vitest setupFile — hide the ambient ndx install from the test suite.
 *
 * WHY: `cli.js` exports its own path as `NDX_CLI_PATH` (and the identical
 * `N_DX_CLI_PATH`) to every child it spawns, so the web server can re-invoke
 * the install that launched it. A dev-link install exports the same variables
 * from the developer's shell, which means `pnpm test` inherits them — and the
 * top rung of `resolveNdxBin`'s ladder (packages/web/src/server/routes-commands.ts)
 * then short-circuits above every rung a test meant to exercise:
 *
 *   expected 'node' to be '/var/folders/.../node_modules/.bin/ndx'
 *
 * The received value was the contributor's own global cli.js. CI never sets
 * these variables, so CI stayed green and the suite was red only for people
 * using the dev-link workflow — the exact contributors most likely to run it.
 *
 * Same shape, and same reason, as tests/setup-session-env.js and
 * tests/setup-color-env.js: an ambient variable production code is right to
 * consult, and which a test must therefore control rather than inherit. Tests
 * that want an env rung set it explicitly to a fixture path.
 *
 * WHY A setupFile RATHER THAN globalSetup: setupFiles run inside each worker
 * before that worker loads any test module, so the variables are gone before
 * any code can read them. globalSetup runs in a different process and would
 * not affect the workers' environment. Child processes the suite spawns are
 * unaffected in practice — a spawned cli.js sets both variables itself.
 */

delete process.env.NDX_CLI_PATH;
delete process.env.N_DX_CLI_PATH;
