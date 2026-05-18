# Contributing to n-dx

Thank you for contributing. This guide covers the extra tooling and steps a
contributor needs beyond what a regular user installs.

---

## Prerequisites

- **Node.js ≥ 18** (Node 22 LTS recommended) — use the version in `.nvmrc` (`nvm use` / `fnm use`)
- **pnpm ≥ 10** — enabled via `corepack enable` (version locked in `package.json`)

See [Platform-specific notes](#platform-specific-notes) for Windows/macOS/Linux setup details.

---

## End-user prerequisites vs contributor prerequisites

| Requirement | User | Contributor |
|-------------|:----:|:-----------:|
| Node.js ≥ 18 (22 LTS recommended) | ✅ | ✅ |
| pnpm ≥ 10 | ✅ | ✅ |
| An LLM API key (Anthropic or OpenAI) | ✅ | optional |
| Git | – | ✅ |
| pnpm workspace bootstrap (`pnpm install`) | – | ✅ |
| TypeScript compiler (installed via pnpm) | – | ✅ |
| Xcode Command Line Tools (macOS) | – | see below |

---

## Setup Steps

A one-shot sequence from fresh clone to passing `pnpm build`:

```sh
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
corepack enable && corepack install   # install the exact pnpm version locked in package.json
pnpm install                           # bootstrap all workspace dependencies
pnpm build                             # compile all packages (TypeScript → dist/)
```

That's it — the build output is in each package's `dist/` directory. Run `pnpm test` to confirm everything passes.

---

## What to Focus On

New contributors get the most traction by targeting areas with clear scope and
quick feedback. Here are three high-leverage starting points:

### 1. Open self-heal items

`ndx self-heal` analyses the codebase and creates tagged PRD tasks from its
findings. Run it with `--capture-only` to populate the backlog without
triggering autonomous execution:

```sh
ndx self-heal --capture-only .
ndx status .          # inspect the tagged items
```

Filter to self-heal tasks specifically:

```sh
rex status --tag self-heal
```

These tasks are small, well-scoped, and come with built-in acceptance
criteria — good for a first contribution.

### 2. PRD items tagged `help-wanted`

Items carrying a `help-wanted` tag are ones the core team has identified as
good contributor targets — they are scoped, described, and unblocked:

```sh
rex status --tag help-wanted
ndx start .           # browse and filter in the dashboard
```

### 3. Documentation gaps

Recent audits have catalogued missing or out-of-date docs:

- `docs/doc-delta-audit.md` — gap inventory from the last audit cycle
- `docs/cli-ui-gap.md` — CLI/UI discrepancies
- `docs/config-schema-ui-gap.md` — config schema coverage gaps

If you find a gap not on the list, add it to the PRD with `ndx add "description"
--tag documentation` so it is tracked.

---

## Development setup

### 1. Node.js

Use the version pinned in `.nvmrc` (**Node 22**). This satisfies the
`engines.node: ">=18.0.0"` requirement and matches CI.

```sh
# nvm
nvm install          # reads .nvmrc automatically
nvm use

# fnm
fnm use              # also reads .nvmrc
```

Any Node ≥ 18 works, but Node 22 LTS is what CI runs.

### 2. pnpm

```sh
# Enable via Corepack (recommended — version is locked in package.json)
corepack enable
corepack install

# Or install manually
npm install -g pnpm@10
```

`package.json` sets `"packageManager": "pnpm@10.33.0"`. Corepack reads this
automatically and installs the exact version.

### 3. Clone and bootstrap

```sh
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
pnpm install        # install all workspace dependencies
pnpm build          # compile all packages (TypeScript → dist/)
```

`pnpm install` at the monorepo root installs every package in `packages/`
through the pnpm workspace. Never run `npm install` here.

### 4. Link the CLI globally (optional)

```sh
cd packages/core
pnpm link --global
```

Link from `packages/core`, not the monorepo root — the published package name
is `@n-dx/core` and the global entry point lives there.

### 5. Common tasks

```sh
pnpm build          # build all packages
pnpm typecheck      # TypeScript type-check all packages
pnpm test           # run full test suite
pnpm preflight      # mirrors CI: build → typecheck → docs → test
```

`pnpm test` runs both the root-level Vitest suite and each package's own test
script. See [TESTING.md](TESTING.md) for test-tier conventions (unit /
integration / e2e).

### 6. Testing changes against a real project (dev-link)

`pnpm link` (step 4) registers the build globally once. To iterate on code changes and test
them inside another project use the **dev-link** skill, which manages the link/unlink cycle:

```sh
# Inside the n-dx monorepo — after editing code:
pnpm build --filter @n-dx/core    # rebuild only the CLI package

# In Claude Code (from inside the n-dx repo):
/dev-link local    # link packages/core globally so `ndx` uses your dev build
```

Then switch to your target project and run `ndx` commands normally. The global `ndx` binary
resolves from your local build.

```sh
/dev-link npm      # when done — restore the published npm version
```

Run `/dev-link` with no argument to check which version is currently active.

---

## How To Contribute

### Branch → commit → PR

1. **Create a topic branch** from `main`:

   ```sh
   git checkout -b feat/your-feature-name
   ```

2. **Make focused changes.** One logical change per commit.

3. **Run the pre-commit gates** — both must pass before you push:

   ```sh
   pnpm typecheck      # TypeScript type-check all packages
   pnpm test           # full test suite
   ```

   Or run both at once with the preflight alias:

   ```sh
   pnpm preflight      # build → typecheck → docs → test (mirrors CI)
   ```

4. **Stage and commit:**

   ```sh
   git add <files>
   git commit -m "feat(package): short description of what and why"
   ```

5. **Run the health gate** before pushing:

   ```sh
   ndx ci .
   ```

   This runs `sourcevision analyze`, validates PRD health, and checks zone
   coupling/cohesion metrics. Fix any gate failures before opening the PR —
   the same gate runs in CI.

6. **Open a pull request** targeting `main`.

---

### Commit trailers

`ndx work` (the autonomous agent loop) appends machine-readable
[git trailers](https://git-scm.com/docs/git-interpret-trailers) to every
commit it creates. Human contributors do not need to write these manually,
but knowing what they mean helps you navigate the project history:

| Trailer | Meaning |
|---------|---------|
| `N-DX-Status: <id> <from> → <to>` | PRD item status transition captured in this commit (e.g. `in_progress → completed`). The dashboard uses this to correlate commits with PRD items. |
| `N-DX: <vendor>/<model> · run <run-id>` | LLM vendor, model name, and hench run ID that authored the commit. |
| `N-DX-Item: <url>` | Direct link to the PRD item in the dashboard. |

If you are closing a PRD task with a manual commit, add an `N-DX-Status`
trailer so the dashboard picks up the transition:

```
feat(rex): fix duplicate detection edge case

N-DX-Status: <item-id> in_progress → completed
```

---

### Linking code to PRD items

When hench runs a task it stages `.rex/prd_tree/` changes alongside the code
in the same commit, so each commit carries both the code delta and the PRD
status transition atomically. For human contributions to a tracked task,
follow the same pattern: stage `.rex/prd_tree/` with your code and include
the `N-DX-Status` trailer. The `ndx status` output and the dashboard both
reflect the change immediately.

---

## Platform-specific notes

### macOS

Some indirect dependencies use native Node add-ons (bindings compiled with
`node-gyp`). If a `pnpm install` fails with a compilation error:

```sh
xcode-select --install
```

This installs the Xcode Command Line Tools (compilers, make, Python). You do
**not** need the full Xcode IDE.

### Linux

No extra steps. CI runs on `ubuntu-latest`; any modern Debian/Ubuntu or
Fedora/RHEL environment works.

### Windows

**WSL2 is the recommended path.** Set up WSL2 with Ubuntu, then follow the
Linux instructions inside the WSL shell.

```powershell
# PowerShell — enable WSL2
wsl --install
```

**Native Windows (experimental).** The CLI smoke tests pass under native
Windows in CI, but `ndx work` (the agent loop) has reduced native test
coverage. POSIX process-group management and shell spawning differ from
WSL/Linux behaviour; you may hit edge cases.

**Docker alternative.** A ready-made Docker image is provided in
[`.local_testing/`](.local_testing/) for running the full test suite in a
Windows Server Core container:

```sh
# macOS / Linux host
./.local_testing/run-gauntlet.sh

# Windows host (PowerShell)
.\.local_testing\run-gauntlet.ps1
```

See [`.local_testing/README.md`](.local_testing/README.md) for full Docker
usage and troubleshooting.

---

## Project layout

```
packages/
  core/            # CLI orchestrator (@n-dx/core)
  sourcevision/    # static analysis engine
  rex/             # PRD management
  hench/           # autonomous agent
  llm-client/      # vendor-neutral LLM client
  web/             # dashboard + MCP HTTP server
tests/             # monorepo-level e2e tests
scripts/           # build and CI helper scripts
.local_testing/    # Docker infrastructure for Windows testing
```

See [PACKAGE_GUIDELINES.md](PACKAGE_GUIDELINES.md) for dependency hierarchy,
gateway conventions, and zone governance.

---

## Code of Conduct

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

[Elastic License 2.0](LICENSE)
