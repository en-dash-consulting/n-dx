---
id: "c17d8735-2570-4af2-9b47-83a6b751e310"
level: "task"
title: "Build Linux/macOS-representative Docker container with ndx base command tests"
status: "completed"
priority: "high"
tags:
  - "testing"
  - "docker"
  - "macos"
  - "infrastructure"
source: "smart-add"
startedAt: "2026-04-20T19:13:53.689Z"
completedAt: "2026-04-20T19:16:21.307Z"
resolutionType: "code-change"
resolutionDetail: "Implemented Dockerfile.macos with Ubuntu LTS base, test-base-commands.sh smoke test script, and ndx-macos docker-compose service. All acceptance criteria met: image builds successfully, runs ndx init/analyze/status/config without errors, docker-compose.yml includes ndx-macos service, proper exit codes on success/failure."
acceptanceCriteria:
  - "Dockerfile.macos builds successfully and produces a working image"
  - "Image runs ndx init, ndx analyze, ndx status, and ndx config without errors inside the container"
  - "docker-compose.yml includes an ndx-macos service that builds from Dockerfile.macos"
  - "Container exits with code 0 on success and non-zero on any command failure"
description: "Create Dockerfile.macos (Ubuntu/Node LTS base) mirroring the structure of Dockerfile.windows — installs Node.js, pnpm, git, builds the monorepo, and runs the base-command smoke test suite (ndx init, ndx analyze, ndx status, ndx config). Add a corresponding `ndx-macos` service to docker-compose.yml alongside the existing `ndx-windows` service."
---
