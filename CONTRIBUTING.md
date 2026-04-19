# Contributing to n-dx

Thank you for contributing. This guide covers the extra tooling and steps a
contributor needs beyond what a regular user installs.

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
