# Standalone Executable

`ndx` also ships as one executable file per platform with Node.js built in.
Nothing else is needed on the machine: no Node.js, no npm, no pnpm.

| Platform | Archive |
|----------|---------|
| Windows x64 / ARM64 | `ndx-<version>-win-x64.zip`, `ndx-<version>-win-arm64.zip` |
| macOS Apple silicon / Intel | `ndx-<version>-darwin-arm64.tar.gz`, `ndx-<version>-darwin-x64.tar.gz` |
| Linux x64 / ARM64 (glibc) | `ndx-<version>-linux-x64.tar.gz`, `ndx-<version>-linux-arm64.tar.gz` |

What you still need is what n-dx drives: `git`, and the assistant CLI you
configure (`claude` or `codex`) for analysis and `ndx work`.

## Install

Unpack the archive for your platform and put `ndx` (`ndx.exe` on Windows) in a
directory on your `PATH`:

```sh
# macOS / Linux
tar -xzf ndx-<version>-linux-x64.tar.gz
sudo install -m 755 ndx /usr/local/bin/ndx
ndx --version
```

```powershell
# Windows: unzip, then move ndx.exe to a folder on PATH, e.g.
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Programs\ndx"
Move-Item ndx.exe "$env:LOCALAPPDATA\Programs\ndx\"
# add that folder to your user PATH, open a new terminal, then:
ndx --version
```

Keep the name `ndx`. `ndx init` writes `.mcp.json` entries that start `ndx`,
so the command name has to be on `PATH`. A copy or symlink named `rex`,
`hench`, `sourcevision` or `sv` runs that tool directly, like the npm package's
extra commands.

`ndx which` reports `install  standalone executable (<path>)`. The update
notice links to the release downloads instead of suggesting `npm i -g`.

## First run

The first time a version runs, it unpacks its runtime (about 85 MB, 9,000
files) into a per-user cache. Later runs start straight from the cache.

| OS | Cache |
|----|-------|
| Windows | `%LOCALAPPDATA%\n-dx\runtime\` |
| macOS | `~/Library/Caches/n-dx/runtime/` |
| Linux | `$XDG_CACHE_HOME/n-dx/runtime/` (default `~/.cache/n-dx/runtime/`) |

Set `NDX_EXE_CACHE` to use another directory. Each version unpacks to its own
folder, and old folders are not removed for you. Delete them whenever no
`ndx` from that version is running; a deleted runtime unpacks again on next
use. `ndx --standalone-info` prints the version, the embedded Node.js and the
runtime folder in use.

Antivirus software can make the first run slow on Windows, because it scans
every unpacked file. Only the first run is affected.

## Signing

The binaries are Node.js's own, with n-dx injected into them. Injection
invalidates the Windows Authenticode signature. The Windows build is unsigned
unless you sign it with your own certificate, so SmartScreen may warn before
it runs. macOS builds are signed ad hoc. A quarantined download is refused
until you clear the flag: `xattr -d com.apple.quarantine ndx`.

## Building it yourself

From a checkout, after `pnpm install`:

```sh
pnpm build:exe                                   # this machine's platform
node scripts/build-exe.mjs --target=all          # every platform
node scripts/build-exe.mjs --target=linux-x64,win-x64 --skip-build
```

Executables land in `dist-exe/<target>/`. The build:

1. runs `pnpm build`, unless you pass `--skip-build`;
2. deploys `@n-dx/core` with its production dependencies from the lockfile
   (`pnpm deploy`), the same files an npm install contains;
3. builds any missing language-pack grammars (`build:grammars`);
4. packs the install into one compressed payload, then injects it, together
   with `scripts/exe/launcher.cjs`, into a Node.js binary as a
   [Single Executable Application](https://nodejs.org/api/single-executable-applications.html).

The embedded Node.js is the version that runs the build. For a different
platform, the matching official binary is downloaded from nodejs.org, checked
against that release's `SHASUMS256.txt`, and cached under `.sea-build/node/`.
A macOS target built anywhere other than a Mac comes out unsigned. Sign it on a
Mac (`codesign --sign - ndx`) before it can run on Apple silicon.

The **Standalone executables** workflow (`.github/workflows/standalone-exe.yml`)
builds every target on its own native runner and smoke-tests each binary. Run
it by hand with a `release-tag` to attach the archives and a `SHA256SUMS.txt`
to that GitHub release.

### How one file runs many programs

n-dx starts its tools as `process.execPath <script.js>`, and inside the
executable `process.execPath` is the executable itself. So the launcher has two
modes. When the first argument is an existing `.js`, `.mjs` or `.cjs` file, it
runs that script the way `node` would. Otherwise it runs `ndx`, or the tool
named by the executable's own name. Every child process, from the dashboard
server and MCP servers to hench's agent tooling and extension commands, goes
through the same binary and the same unpacked runtime.

See: [Skills Reference](./skills) for the assistant skills `ndx init` installs; they work the same with the standalone `ndx`.
