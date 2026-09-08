# Local Testing Infrastructure

This directory contains Docker configurations and scripts for running ndx tests in isolated containers. Supports Windows (Server Core) and macOS/Linux (Ubuntu) platforms with automated platform detection.

## Quick Start

Run the gauntlet test suite in a Docker container (builds image automatically):

### macOS / Linux:
```bash
./.local_testing/run-gauntlet.sh
```

### Windows (PowerShell):
```powershell
.\.local_testing\run-gauntlet.ps1
```

## Files

- **run-gauntlet.sh** - Bash script for Unix/Linux/macOS hosts (supports platform auto-detection)
- **run-gauntlet.ps1** - PowerShell script for Windows hosts  
- **Dockerfile.windows** - Windows Server Core image with Node.js LTS, npm, git, and all ndx dependencies
- **Dockerfile.macos** - macOS/Linux image based on Ubuntu LTS with Node.js, bash, git, and all ndx dependencies
- **docker-compose.yml** - Docker Compose configuration for both Windows (ndx-windows) and macOS (ndx-macos) services
- **test-base-commands.sh** - Base command smoke test script (ndx config, init, analyze, status)
- **.dockerignore** - Files excluded from Docker build context

## Platform Comparison

| Platform | Host OS | Container Base | Dockerfile | Runner Script | Docker Service | Base Commands |
|----------|---------|-----------------|-----------|---------------|----------------|----------------|
| **Windows** | Windows (any) | Windows Server Core (LTSC 2022) | `Dockerfile.windows` | `run-gauntlet.ps1` | `ndx-windows` | PowerShell: `pnpm test` |
| **macOS** | macOS (Intel/Apple Silicon) | Ubuntu 20.04 LTS | `Dockerfile.macos` | `run-gauntlet.sh` | `ndx-macos` | Bash: `pnpm test` + `/ndx/test-base-commands.sh` |
| **Linux** | Linux (any) | Ubuntu 20.04 LTS | `Dockerfile.macos` | `run-gauntlet.sh` | `ndx-macos` | Bash: `pnpm test` + `/ndx/test-base-commands.sh` |

The `run-gauntlet.sh` script automatically detects the host platform (macOS, Linux, or Windows via MSYS/CYGWIN) and selects the appropriate Dockerfile. Use `--platform=<os>` to override detection.

## Run Gauntlet Script Usage

### Bash (macOS/Linux)

```bash
# Basic usage - builds image and runs tests
./run-gauntlet.sh

# Skip image build (use existing)
./run-gauntlet.sh --no-build

# Keep container after tests (for inspection)
./run-gauntlet.sh --keep-container

# Run in background (don't stream output)
./run-gauntlet.sh --detach

# Verbose output for debugging
./run-gauntlet.sh --verbose

# Show help
./run-gauntlet.sh --help

# Combine options
./run-gauntlet.sh --no-build --verbose
```

### PowerShell (Windows)

```powershell
# Basic usage - builds image and runs tests
.\run-gauntlet.ps1

# Skip image build
.\run-gauntlet.ps1 -NoBuild

# Keep container for inspection
.\run-gauntlet.ps1 -KeepContainer

# Run in background
.\run-gauntlet.ps1 -Detach

# Verbose output
.\run-gauntlet.ps1 -Verbose

# Show help
.\run-gauntlet.ps1 -Help

# Combine options
.\run-gauntlet.ps1 -NoBuild -Verbose
```

## Environment Variables

Customize container behavior via environment variables:

```bash
# Custom container name (default: ndx-gauntlet-test)
export CONTAINER_NAME=my-test-container
./run-gauntlet.sh

# Custom image tag (default: ndx-gauntlet:latest)
export IMAGE_TAG=ndx:v1.2.3
./run-gauntlet.sh

# Use Docker BuildKit for faster builds
export DOCKER_BUILDKIT=1
./run-gauntlet.sh
```

## Exit Codes

The test runner scripts return meaningful exit codes:

- **0** - All tests passed ✓
- **1** - Tests failed (one or more test case failed)
- **2** - Docker command failed (build, run, or daemon error)
- **3** - Configuration error (missing Docker, invalid options)

Example:
```bash
./run-gauntlet.sh
if [ $? -eq 0 ]; then
    echo "Tests passed!"
else
    echo "Tests failed or error occurred"
fi
```

## Container Features

### Windows Container
- ✅ Windows Server Core (LTSC 2022) base image
- ✅ Node.js 20 LTS installed from official Docker image
- ✅ npm and pnpm package managers
- ✅ Git installed via Chocolatey
- ✅ PowerShell shell environment
- ✅ All ndx dependencies installed via `pnpm install`
- ✅ Project build completed during image creation (`npm run build`)
- ✅ Ready to run `pnpm test` immediately

### macOS/Linux Container
- ✅ Ubuntu 20.04 LTS base image
- ✅ Node.js 20 LTS installed from official Docker image
- ✅ npm and pnpm package managers
- ✅ Git installed via apt
- ✅ Bash shell environment
- ✅ All ndx dependencies installed via `pnpm install`
- ✅ Project build completed during image creation (`npm run build`)
- ✅ Base command smoke test script included (`test-base-commands.sh`)
- ✅ Ready to run tests immediately

## Manual Docker Operations

### Windows Container

#### Build the image:
```bash
docker build -f .local_testing/Dockerfile.windows -t ndx-gauntlet:windows .
```

#### Run tests with docker-compose:
```bash
docker-compose -f .local_testing/docker-compose.yml run ndx-windows
```

#### Run tests with docker directly:
```bash
docker run -it --rm -e NODE_ENV=test ndx-gauntlet:windows powershell -Command "pnpm test"
```

### macOS/Linux Container

#### Build the image:
```bash
docker build -f .local_testing/Dockerfile.macos -t ndx-gauntlet:macos .
```

#### Run tests with docker-compose:
```bash
docker-compose -f .local_testing/docker-compose.yml run ndx-macos
```

#### Run tests with docker directly (full test suite):
```bash
docker run -it --rm -e NODE_ENV=test ndx-gauntlet:macos /bin/bash -c "pnpm test"
```

#### Run base commands smoke tests:
```bash
docker run -it --rm -e NODE_ENV=test ndx-gauntlet:macos /bin/bash -c "/ndx/test-base-commands.sh"
```

### Common Operations

#### View running containers:
```bash
docker ps
```

#### View container logs:
```bash
docker logs <container_name>
```

#### Stop a running container:
```bash
docker stop <container_name>
```

#### Remove a stopped container:
```bash
docker rm <container_name>
```

## Troubleshooting

### Docker daemon not running
**Error:** `Docker daemon is not running`
- **Solution:** Start Docker Desktop (Windows/macOS) or ensure Docker service is running (Linux)

### Docker not found in PATH
**Error:** `Docker is not installed or not in PATH`
- **Solution:** Install Docker Desktop from https://www.docker.com/products/docker-desktop

### Container fails to start
**Steps:**
1. Check Docker is running: `docker ps`
2. Verify image exists: `docker images | grep gauntlet`
3. View build errors (Windows): `docker build -f .local_testing/Dockerfile.windows . --progress=plain`
4. View build errors (macOS/Linux): `docker build -f .local_testing/Dockerfile.macos . --progress=plain`
5. Enable verbose output: `./run-gauntlet.sh --verbose`

### Tests fail in container but pass locally
**Possible causes:**
- Different Node.js version on Windows (container uses Node.js LTS)
- Windows-specific path issues (`\` vs `/`)
- File permission differences
- Environment variable differences (set `NODE_ENV=test`)

**Debug steps:**
1. Keep container: `./run-gauntlet.sh --keep-container`
2. Run shell in stopped container: `docker run -it ndx-gauntlet:latest powershell`
3. Check test output: `./run-gauntlet.sh --verbose 2>&1 | tee test-output.log`

### Container won't clean up
**If container remains after script completes:**
```bash
# Find it
docker ps -a | grep gauntlet

# Remove it
docker rm <container_name>
```

### Large Docker image size
The Windows Server Core base image is ~2GB. This is expected:
- Check size: `docker images | grep gauntlet`
- Accept as baseline for reliable Windows testing environment
- First build downloads base image; subsequent builds are faster

## Output Streaming

The gauntlet scripts stream test output in real-time:

```
[INFO] ndx Gauntlet Test Runner

[INFO] Building Docker image: ndx-gauntlet:latest
[INFO] Dockerfile: .local_testing/Dockerfile.windows
[INFO] Context: /path/to/n-dx-internal
...build output...
[✓] Docker image built successfully

[INFO] Starting container: ndx-gauntlet-test
[INFO] Running command: pnpm test
...test output with progress indicators...
[✓] Tests completed successfully

[✓] Cleaned up container: ndx-gauntlet-test
```

## Relationship to CI

This directory is **not** what runs in CI, and the two cover different things. Use it to reproduce a platform failure locally, not to predict what CI will check.

What [`ci.yml`](../.github/workflows/ci.yml) actually runs across platforms:

| Job | Runner | Contents |
|-----|--------|----------|
| `Build & Validate` | `ubuntu-latest` | obfuscation check, build, publish source-map check, typecheck, docs build, `pnpm pr-check`, per-package suites, root e2e / integration, changeset gates |
| `CLI Smoke (macOS)` | `macos-latest` | smoke collection **with per-OS baseline assertions**; root e2e / integration only on merges to `main` (macOS bills at 10× Linux) |
| `CLI Smoke (Windows)` | `windows-latest` | smoke collection with per-OS baseline assertions, root e2e / integration, per-package suites — all on every run |
| `CLI Smoke Parity` | `ubuntu-latest` | cross-OS comparison only: canonical sequence, `comparable` projection, normalized failure codes, raw separator / line-ending fingerprint |

Two consequences worth knowing before you rely on either surface:

- The per-OS CLI contract is asserted in the smoke **collect** step, so a platform-specific regression fails the platform that broke it. It is no longer checked in the parity job, where it was skipped whenever a smoke job was already red.
- A POSIX-semantics defect can pass PR CI and be caught on the merge-to-`main` run instead. If you are changing spawn, process-lifecycle, or path-handling code, run the root suite locally — via the containers here or directly — rather than waiting on the macOS PR job.

Full detail: [`docs/contributing/cli-smoke-parity.md`](../docs/contributing/cli-smoke-parity.md) and the cost/value rationale in [`docs/contributing/cross-os-pipeline-review-2026-09.md`](../docs/contributing/cross-os-pipeline-review-2026-09.md).

### Invoking these scripts from a pipeline

The containers here are host-agnostic and can be driven from any CI system:

```bash
#!/bin/bash
# GitHub Actions example
./.local_testing/run-gauntlet.sh --verbose
exit_code=$?

if [ $exit_code -ne 0 ]; then
    echo "Gauntlet tests failed"
    exit 1
fi
```

Note that `ci.yml` does **not** do this — it runs the suites directly on hosted runners. Docker-in-CI here would pay the ~2GB Windows Server Core pull on every run for no additional signal.

## Notes

- First build downloads the Windows Server Core base image (~2GB) - this takes a few minutes
- Subsequent builds use cached layers and are faster
- The container automatically installs and builds the entire ndx project
- Test results are streamed directly to your terminal
- Container cleanup uses `--rm` flag by default (automatic removal)
- To preserve a container for inspection, use `--keep-container` flag
