---
id: "c17d8735-2570-4af2-9b47-83a6b751e310"
type: "change"
title: "Build Linux/macOS-representative Docker container with ndx base command tests"
slug: "build-linux-macos-representative"
intent: "Create Dockerfile.macos (Ubuntu/Node LTS base) mirroring the structure of Dockerfile.windows — installs Node.js, pnpm, git, builds the monorepo, and runs the base-command smoke test suite (ndx init, ndx analyze, ndx status, ndx config). Add a corresponding `ndx-macos` service to docker-compose.yml alongside the existing `ndx-windows` service."
acceptanceCriteria:
  - "Dockerfile.macos builds successfully and produces a working image"
  - "Image runs ndx init, ndx analyze, ndx status, and ndx config without errors inside the container"
  - "docker-compose.yml includes an ndx-macos service that builds from Dockerfile.macos"
  - "Container exits with code 0 on success and non-zero on any command failure"
touches:
  - "9dbecc75-f550-4b7b-b3b7-fc2bb3ffef53"
priority: "high"
tags:
  - "testing"
  - "docker"
  - "macos"
  - "infrastructure"
source: "smart-add"
---
