---
id: "5a24a938-4bbe-4f27-a036-bfdf08400af8"
type: "capability"
title: "Local Test Suite Documentation in Main README"
slug: "local-test-suite-documentation-in-main"
statement: "The main README has a Local Platform Testing section that explains how to run the Docker-based Windows and macOS test suites from the repo root, and .local_testing/README.md gives the guidance for both platforms in one place."
criteria: [{"id":"c1","text":"README.md shall contain a 'Local Platform Testing' section that gives the commands to run the Windows and macOS gauntlet suites."},{"id":"c2","text":"The 'Local Platform Testing' section shall list the prerequisites, including the required Docker Desktop version and the disk space needed for images."},{"id":"c3","text":"The 'Local Platform Testing' section shall give run commands that work unchanged when pasted at the repo root."},{"id":"c4","text":"The 'Local Platform Testing' section shall describe the expected output and exit codes of the suites."},{"id":"c5","text":"The 'Local Platform Testing' section shall link to .local_testing/README.md for advanced options."},{"id":"c6","text":"The 'Local Platform Testing' section shall name only scripts and Dockerfiles that are present in .local_testing/."},{"id":"c7","text":".local_testing/README.md shall describe Dockerfile.macos, what it is for, and the command that runs it."},{"id":"c8","text":".local_testing/README.md shall contain a platform comparison table that lists the Windows and macOS containers with their Dockerfile names and runner scripts."},{"id":"c9","text":"The 'Container Features' section of .local_testing/README.md shall cover what the macOS container can do."},{"id":"c10","text":"The manual Docker operations section of .local_testing/README.md shall give the commands to build and run the macOS image."}]
source: "smart-add"
---

The main README references .local_testing/ in passing but has no dedicated section explaining how to run the Docker-based local test suite, what prerequisites are needed, or what commands to use. Users need a self-contained guide in README.md so they can find and run local platform tests without digging into .local_testing/README.md.
