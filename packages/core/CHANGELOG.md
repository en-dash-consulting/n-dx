# @n-dx/core

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/sourcevision@0.3.4
  - @n-dx/llm-client@0.3.4
  - @n-dx/hench@0.3.4
  - @n-dx/rex@0.3.4
  - @n-dx/web@0.3.4

## 0.3.3

### Patch Changes

- [#194](https://github.com/en-dash-consulting/n-dx/pull/194) [`e1dbec6`](https://github.com/en-dash-consulting/n-dx/commit/e1dbec68bd350dc15293fbf473b0c285a09c4f04) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix `ndx` crashing on launch with `ERR_MODULE_NOT_FOUND: ./pair-programming.js`. The file is now included in the published `@n-dx/core` package's `files` array; previously `cli.js` imported a file that was excluded from the tarball.

  Docs: add an **Existing project onboarding** guide for adopting ndx into a repo with real history, expand the **Quickstart** with screenshots of `ndx init` / `analyze` / `plan` / `status` / `work`, and add a `@n-dx/core` package README so the npm landing page is no longer empty.

- Updated dependencies [[`700f356`](https://github.com/en-dash-consulting/n-dx/commit/700f356b146864e2aacafd9f0cace42a7942add8)]:
  - @n-dx/web@0.3.3
  - @n-dx/rex@0.3.3
  - @n-dx/hench@0.3.3
  - @n-dx/sourcevision@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd), [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363), [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48)]:
  - @n-dx/hench@0.3.2
  - @n-dx/rex@0.3.2
  - @n-dx/web@0.3.2
  - @n-dx/sourcevision@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- [#172](https://github.com/en-dash-consulting/n-dx/pull/172) [`c1e1f5f`](https://github.com/en-dash-consulting/n-dx/commit/c1e1f5f19acba2990c63c3ffc6cb8016d52c233b) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `ndx` binary crashing on npm install due to missing files in the published tarball

  - `packages/core/package.json` `files` array was missing `assistant-integration.js` and `codex-integration.js`
  - `cli.js` statically imports `assistant-integration.js`, which in turn statically imports `codex-integration.js`, so the resolution failure happened at module load before any error handling could run
  - Verified via `npm pack --dry-run`: tarball now ships 25 files, and the transitive static-import graph from `cli.js` resolves cleanly

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/hench@0.3.1
  - @n-dx/sourcevision@0.3.1
  - @n-dx/llm-client@0.3.1
  - @n-dx/web@0.3.1

## 0.3.0

### Minor Changes

- [#158](https://github.com/en-dash-consulting/n-dx/pull/158) [`29a1fb0`](https://github.com/en-dash-consulting/n-dx/commit/29a1fb0185570191173a08dec78476e7a43ad10f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Vendor-neutral assistant integration layer for ndx init

  - Add assistant-integration orchestration that provisions Claude and Codex surfaces independently of the active LLM vendor
  - Add init-llm module with interactive provider/model selection via enquirer (flag > config > prompt precedence)
  - Add vendor-specific model flags (--claude-model, --codex-model) that persist independently
  - Fix MCP server re-registration: remove before re-add so ndx init is idempotent
  - Surface MCP registration error details in init summary instead of silent failures
  - Integrate child-lifecycle process tracking and signal handlers from main
  - Add machine-local config support (.n-dx.local.json) for CLI paths and other per-machine settings

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#164](https://github.com/en-dash-consulting/n-dx/pull/164) [`b9d59f2`](https://github.com/en-dash-consulting/n-dx/commit/b9d59f2da1653066a53068ef3f244f443c5ea615) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `cli.timeouts.<command>` being silently ignored when stored as a string

  - `ndx config cli.timeouts.work <ms>` now stores the value as a number (numeric-shaped strings and `"true"`/`"false"` are auto-coerced when setting a brand-new key)
  - `resolveCommandTimeout` accepts numeric strings defensively, so existing configs that were written as strings by earlier versions start working without a re-set
  - `ndx init` runs a new config-repair pass that rewrites known-numeric paths (`cli.timeoutMs`, `cli.timeouts.*`, `web.port`) as proper numbers and reports what was repaired

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/sourcevision@0.3.0
  - @n-dx/llm-client@0.3.0
  - @n-dx/hench@0.3.0
  - @n-dx/rex@0.3.0
  - @n-dx/web@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/sourcevision@0.2.3
  - @n-dx/llm-client@0.2.3
  - @n-dx/hench@0.2.3
  - @n-dx/rex@0.2.3
  - @n-dx/web@0.2.3

## 0.2.2

### Patch Changes

- [#153](https://github.com/en-dash-consulting/n-dx/pull/153) [`b99f8a7`](https://github.com/en-dash-consulting/n-dx/commit/b99f8a7d2a0055fbed57acc04e8a2df21bfa92b7) Thanks [@dnaniel](https://github.com/dnaniel)! - Immersive animated init experience with Ink TUI framework

  - Walking T-Rex mascot with shaded pixel art (half-block fg/bg color technique)
  - Ink-based animated UI with React components (htm/react for JSX without build step)
  - Braille spinners for each init phase, smooth animation via child process offloading
  - Sourcevision fast analysis (--fast) runs during init for immediate codebase data
  - Graceful degradation: static fallback for non-TTY, --quiet mode, NO_COLOR support
  - Actionable next-steps menu with CLI commands and skill suggestions
  - New dependencies: ink, react, htm

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/sourcevision@0.2.2
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2
  - @n-dx/web@0.2.2
  - @n-dx/hench@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/hench@0.2.1
  - @n-dx/rex@0.2.1
  - @n-dx/web@0.2.1
  - @n-dx/sourcevision@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Minor Changes

- [#120](https://github.com/en-dash-consulting/n-dx/pull/120) [`e14ea38`](https://github.com/en-dash-consulting/n-dx/commit/e14ea3841297390ba2a7b1ee589e1e422425ec5e) Thanks [@dnaniel](https://github.com/dnaniel)! - Extract @n-dx/core into packages/core/ as a proper workspace package. Fixes workspace:\* dependency leak that prevented npm installation.

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/hench@0.2.0
  - @n-dx/sourcevision@0.2.0
  - @n-dx/llm-client@0.2.0
  - @n-dx/web@0.2.0
