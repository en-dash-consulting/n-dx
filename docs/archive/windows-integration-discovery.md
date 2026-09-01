# Windows Integration Discovery

## Goal

Identify likely Windows compatibility gaps in `n-dx` without direct Windows execution.

This document is intentionally split into:

- **Confirmed evidence**: behavior implied directly by the current source or test suite
- **Inferences**: likely runtime problems that still need native Windows confirmation

## Constraint

This pass was performed from macOS only. No commands in this document have been validated on native Windows yet.

## Method

Static discovery focused on these areas:

1. CLI entrypoints and package scripts
2. Shell/process execution helpers
3. Config validation and assistant setup
4. Export/deploy flows
5. Tests and CI coverage
6. User-facing setup documentation

## Existing Windows-Aware Behavior

The repo is not Windows-blind. There is already explicit Windows handling in a few critical areas:

- `packages/llm-client/src/cli-provider.ts:118-122` uses `shell: process.platform === "win32"` and `packages/llm-client/src/cli-provider.ts:160-166` handles the Windows "not recognized" failure mode.
- `packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts:65-95` contains Windows-specific quoting and stdin handling for `cmd.exe`.
- `packages/llm-client/src/exec.ts:171-174` switches between `where` and `which` when probing binaries on PATH.
- `packages/sourcevision/src/analyzers/workspace.ts:113-117` normalizes both `/` and `\` when deriving IDs from paths.
- `tests/e2e/cli-init.test.js:8-24` and similar e2e helpers generate `.cmd` test doubles on Windows, so some assistant/bootstrap flows were designed with Windows in mind.

## Gap Matrix

| Area | Status | Confidence | Evidence | Likely user impact |
| --- | --- | --- | --- | --- |
| Agent shell execution assumes `sh` exists | Likely broken on native Windows | High | `packages/llm-client/src/exec.ts:122-130`, `packages/hench/src/tools/exec-shell.ts:26-35`, `packages/hench/src/guard/commands.ts:6-9`, `packages/hench/src/guard/commands.ts:58-60` | `run_command`, `git` tool execution, and any shell-backed tool path can fail unless Git Bash/WSL happens to provide `sh` |
| Verification and post-task test execution assume `sh` | Likely broken on native Windows | High | `packages/rex/src/core/verify.ts:279-286`, `packages/hench/src/validation/completion.ts:83-88`, `packages/hench/src/tools/rex.ts:244-253`, `packages/hench/src/tools/test-runner.ts:360-364` | `rex verify`, completion validation, automated requirements, and post-task test runs may fail even when the underlying test command is otherwise valid |
| GitHub Pages deploy path uses Unix shell commands | Confirmed gap | High | `packages/core/export.js:465`, `packages/core/export.js:479` | `ndx export --deploy=github` is very likely unusable from native Windows shells |
| CLI-path validation is POSIX-oriented | Likely incomplete | Medium-High | `packages/core/config.js:233-239`, `packages/core/config.js:273-279` | Windows users may get misleading `chmod +x` guidance or pass validation with paths that are not actually runnable the way Windows expects |
| Windows coverage is intentionally skipped in some config tests | Confirmed coverage gap | High | `tests/e2e/cli-config.test.js:711-718`, `tests/e2e/cli-config.test.js:799-809` | Config behavior that matters on Windows is not being exercised in automated tests |
| Permission semantics are not validated on Windows | Confirmed coverage gap | High | `tests/e2e/cli-config.test.js:935-965` | Sensitive-file permission behavior may differ silently on Windows |
| Contributor publish workflow contains POSIX shell syntax | Confirmed gap | High | `package.json:19` | Local release/publish flows can fail from Windows shells even if runtime features work |
| CI runs only on Ubuntu | Confirmed coverage gap | High | `.github/workflows/ci.yml:21-24` | Windows regressions can merge with no automated detection |
| User docs are Unix-centric | Confirmed docs gap | High | `docs/guide/getting-started.md:48-70` | Windows users do not get native setup guidance, especially for environment variables and CLI-path expectations |

## Highest-Risk Product Areas

If a coworker says "Windows integration is not seamless", these are the first places I would expect the breakage to show up:

1. `hench` command execution
   Because the architecture still treats `sh -c` as the command runner contract.

2. Requirement/test validation
   Because both `rex verify` and `hench` completion/test flows reuse shell-backed execution helpers.

3. `ndx export --deploy=github`
   Because the implementation currently shells out to `git rm -rf` and `rm -rf`.

4. `ndx config ...cli_path`
   Because the validation and remediation text are written from a POSIX executable model.

## What Is Missing From The Docs

Current setup docs do not define a native Windows path. The most obvious example is `docs/guide/getting-started.md:54`, which only shows:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

There is no parallel guidance for PowerShell or `cmd.exe`, and there is no section that states whether native Windows, Git Bash, or WSL is the supported baseline.

## Recommended Discovery Process

Use this process when a Windows machine or Windows CI runner becomes available.

### Phase 1: Decide the support target

Pick one baseline and write it down before testing:

- Native PowerShell 7
- Native `cmd.exe`
- Git Bash on Windows
- WSL only

If the product only works in Git Bash or WSL, that should be documented as a constraint, not described as seamless Windows support.

### Phase 2: Run native Windows smoke commands

Run these from **PowerShell first**, not Git Bash, to expose true native issues:

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
node packages/core/cli.js init .
node packages/core/cli.js analyze .
node packages/core/cli.js recommend .
node packages/core/cli.js start .
node packages/core/cli.js refresh --ui-only --no-build .
node packages/core/cli.js export --out-dir dist .
```

Then target the suspicious paths:

```sh
node packages/core/cli.js config llm.claude.cli_path claude .
node packages/core/cli.js config llm.codex.cli_path codex .
node pr-check.js .
node packages/core/cli.js export --deploy=github .
node packages/rex/dist/cli/index.js verify .
```

Finally validate `hench` shell-backed behavior with a disposable project:

1. Trigger a task that runs post-task tests.
2. Trigger a task that exercises requirement validation.
3. Trigger a task that needs `git` tool or `run_command`.

### Phase 3: Record outcomes uniformly

For each failure, capture:

- Exact command
- Shell used (`pwsh`, `cmd`, Git Bash, WSL)
- Exit code
- First failing stderr line
- Whether the same command succeeds under Git Bash or WSL

That last point matters: a pass in Git Bash but fail in PowerShell is evidence of a native Windows compatibility gap, not a clean bill of health.

## Recommended Fix Order

1. Remove the `sh -c` dependency from shared execution helpers.
2. Replace Unix-only `rm -rf` and shell redirection in `packages/core/export.js` with Node filesystem calls or direct `git` invocations.
3. Split CLI-path validation into platform-aware logic for POSIX vs Windows executable resolution.
4. Add a `windows-latest` CI lane for at least build, typecheck, and targeted smoke tests.
5. Add Windows setup docs for PowerShell and clarify whether Git Bash/WSL are supported or merely workarounds.

## Suggested Acceptance Criteria For "Windows Support"

Do not call Windows support complete until all of the following are true:

- CI includes a native Windows job.
- `init`, `analyze`, `recommend`, `start`, and `refresh` pass in PowerShell.
- `hench` can execute at least one task end-to-end without requiring `sh`.
- `rex verify` works with the documented Windows shell.
- Documentation includes Windows-specific setup instructions and troubleshooting.

