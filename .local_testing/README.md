# Local Testing Infrastructure

This directory contains Docker configurations and scripts for running ndx tests in isolated Windows environments.

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

- **run-gauntlet.sh** - Bash script for Unix/Linux/macOS hosts
- **run-gauntlet.ps1** - PowerShell script for Windows hosts  
- **Dockerfile.windows** - Windows Server Core image with Node.js LTS, npm, git, and all ndx dependencies
- **docker-compose.yml** - Docker Compose configuration for simplified container management
- **.dockerignore** - Files excluded from Docker build context

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

- ✅ Windows Server Core (LTSC 2022) base image
- ✅ Node.js LTS installed from official Docker image
- ✅ npm and pnpm package managers
- ✅ Git installed and available
- ✅ All ndx dependencies installed via `pnpm install`
- ✅ Project build completed during image creation (`npm run build`)
- ✅ Ready to run gauntlet tests immediately

## Manual Docker Operations

### Build the image:
```bash
docker build -f .local_testing/Dockerfile.windows -t ndx-gauntlet:latest .
```

### Run tests with docker-compose:
```bash
docker-compose -f .local_testing/docker-compose.yml run ndx-windows
```

### Run tests with docker directly:
```bash
docker run -it --rm -e NODE_ENV=test ndx-gauntlet:latest powershell -Command "pnpm test"
```

### View running containers:
```bash
docker ps
```

### View container logs:
```bash
docker logs <container_name>
```

### Stop a running container:
```bash
docker stop <container_name>
```

### Remove a stopped container:
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
3. View build errors: `docker build -f .local_testing/Dockerfile.windows . --progress=plain`
4. Enable verbose output: `./run-gauntlet.sh --verbose`

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

## CI/CD Integration

These scripts can be integrated into CI/CD pipelines:

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

## Notes

- First build downloads the Windows Server Core base image (~2GB) - this takes a few minutes
- Subsequent builds use cached layers and are faster
- The container automatically installs and builds the entire ndx project
- Test results are streamed directly to your terminal
- Container cleanup uses `--rm` flag by default (automatic removal)
- To preserve a container for inspection, use `--keep-container` flag
