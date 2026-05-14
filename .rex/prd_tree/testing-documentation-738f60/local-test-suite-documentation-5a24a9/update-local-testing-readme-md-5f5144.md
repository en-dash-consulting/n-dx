---
id: "5f514493-0b61-4348-b826-fb4d1e3a32cf"
level: "task"
title: "Update .local_testing/README.md to cover macOS suite and unify platform guidance"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "testing"
  - "docker"
  - "macos"
source: "smart-add"
startedAt: "2026-04-20T19:40:19.135Z"
completedAt: "2026-04-20T19:44:11.316Z"
resolutionType: "code-change"
resolutionDetail: "Updated .local_testing/README.md with comprehensive macOS documentation including platform comparison table, updated Container Features section, and Manual Docker Operations with macOS-specific commands. Added .gitignore exceptions to track Docker configs and documentation files."
acceptanceCriteria:
  - ".local_testing/README.md documents Dockerfile.macos, its purpose, and the run command"
  - "A platform comparison table lists Windows vs macOS containers with Dockerfile names and runner scripts"
  - "The 'Container Features' section is updated to include macOS container capabilities"
  - "Manual Docker operations section includes macOS image build and run commands"
description: "Once the macOS container exists, update .local_testing/README.md to document the new Dockerfile.macos, docker-compose ndx-macos service, and the macOS runner script. Add a 'Platform comparison' table showing which Dockerfile targets which host OS, and what the base commands under test are for each platform."
---
