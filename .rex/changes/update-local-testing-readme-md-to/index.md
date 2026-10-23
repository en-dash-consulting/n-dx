---
id: "5f514493-0b61-4348-b826-fb4d1e3a32cf"
type: "change"
title: "Update .local_testing/README.md to cover macOS suite and unify platform guidance"
slug: "update-local-testing-readme-md-to"
intent: "Once the macOS container exists, update .local_testing/README.md to document the new Dockerfile.macos, docker-compose ndx-macos service, and the macOS runner script. Add a 'Platform comparison' table showing which Dockerfile targets which host OS, and what the base commands under test are for each platform."
acceptanceCriteria:
  - ".local_testing/README.md documents Dockerfile.macos, its purpose, and the run command"
  - "A platform comparison table lists Windows vs macOS containers with Dockerfile names and runner scripts"
  - "The 'Container Features' section is updated to include macOS container capabilities"
  - "Manual Docker operations section includes macOS image build and run commands"
touches:
  - "5a24a938-4bbe-4f27-a036-bfdf08400af8"
priority: "medium"
tags:
  - "docs"
  - "testing"
  - "docker"
  - "macos"
source: "smart-add"
---
