---
id: "8b16401f-3532-4cd9-9d8b-90e128c1fa24"
level: "task"
title: "Triage the first macOS CI run of the root suite"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "ci"
  - "macos"
  - "testing"
  - "verification"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The first macOS CI run of the root suite has been read and its result recorded (file/test/duration counts, or the failure inventory)"
  - "Any macOS-specific failure is triaged individually, not resolved by disabling the job"
  - "Any remaining macOS skip cites a concrete OS limitation rather than convenience"
  - "The estimated billed-minute delta is replaced with the observed figure from real runs"
  - "An explicit keep-or-drop decision is recorded for the macOS job based on the observed cost/benefit"
description: "The sibling CI-matrix task required a local full-suite run on Windows AND macOS before wiring CI, to size the damage in advance. Windows was measured directly (90 files, 2063 passed, 1 skipped, 0 failed, 80s wall on Windows 11). macOS COULD NOT BE MEASURED — there is no macOS machine available to this project's current development setup, and no amount of local work substitutes for it.\n\nThe matrix was wired for macOS anyway, on the reasoning that macOS is POSIX like the already-fully-green ubuntu job, so its risk profile is far closer to ubuntu's than to Windows's. That is an argument, not evidence. The first CI run on macos-latest IS the measurement, and it needs a human to look at it.\n\nWHAT TO DO on the first PR that runs the expanded matrix:\n1. Read the `CLI Smoke (macOS)` job's \"Run root e2e / integration tests\" step.\n2. If green: record the file/test/duration counts here and close. Compare wall-clock against the Windows job to validate or correct the billed-minute estimate below.\n3. If red: triage per failure rather than disabling the job. Likely macOS-specific causes, in rough order of probability:\n   - case-insensitive HFS+/APFS paths (a test asserting two paths differ, or relying on case-sensitive lookup)\n   - BSD vs GNU userland in any test that shells out (`sed -i`, `stat`, `date` flag differences)\n   - `/private/var` vs `/var` symlink for tmpdir — a test comparing a realpath'd temp path against the raw one will mismatch\n   - stricter default file-descriptor / process limits than ubuntu\n   - Gatekeeper/quarantine on freshly written executable fixtures\n4. Quarantine anything genuinely macOS-specific with an explicit reason, not a bare skip — the parent epic requires remaining skips to cite a real OS limitation.\n\nCOST NOTE TO VALIDATE: macOS is billed at 10x Linux minutes on GitHub-hosted private repos (Windows is 2x). Estimated from local timings, the macOS job accounts for roughly 30 of the ~38 added billed minutes per run — about 80% of the cost of this whole matrix expansion, for the least incremental information, since ubuntu already covers POSIX domain behaviour. If CI cost becomes a problem, dropping macOS and keeping Windows is the right trade, and this task should record that decision rather than leaving it implicit."
---
