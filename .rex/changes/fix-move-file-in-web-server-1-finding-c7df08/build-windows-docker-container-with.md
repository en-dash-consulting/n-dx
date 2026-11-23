---
id: "012cf7ae-dcd3-45bc-87a5-98b69c1d48b8"
type: "task"
title: "Build Windows Docker container with ndx dependencies"
slug: "build-windows-docker-container-with"
description: "Create a Dockerfile using Windows base image that installs Node.js, npm, git, and all ndx project dependencies. Container should be ready to run gauntlet tests immediately after build."
acceptanceCriteria:
  - "Dockerfile exists in .local_testing/ using Windows base image (windows/servercore or windows/nanoserver)"
  - "Container successfully installs Node.js LTS and npm"
  - "Container has git installed and configured"
  - "pnpm install runs successfully in container during build"
  - "Container builds without errors and can be verified with test entrypoint"
priority: "high"
tags:
  - "infrastructure"
  - "docker"
  - "windows"
source: "smart-add"
---
