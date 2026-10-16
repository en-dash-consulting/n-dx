---
id: "60af2ee7-b6dd-4e30-81fc-59baf0261320"
level: "task"
title: "Make the over-cap chunked-body 413 test accept the server hanging up mid-body"
status: "pending"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #523"
  - "EPIPE/ECONNRESET from the client write no longer fails the test by itself"
  - "The test still fails if the server closes the connection without sending a 413 (shown with a temporary broken server, reverted before commit)"
  - "No change to MAX_REQUEST_BODY_BYTES or to any file under packages/web/src"
  - "The file passes 20 times in a loop and under the full parallel web suite"
description: "GitHub #523. packages/web/tests/unit/request-security.test.ts › \"answers 413 on an over-cap chunked body that declares no Content-Length\" (around line 435) fails under parallel load with `write EPIPE`. The client queues the whole over-cap chunked body at once; the server answers 413 and closes the socket, which is correct. Under load the client's queued write hits the closed socket, EPIPE destroys the socket, and the error handler rejects because nothing has been read yet (`if (!buf) reject(err)`). The 413 may have been sent but never read.\n\nThat guard was written on purpose: the original server bug (readBody destroying the socket before answering, adversarial-review finding, completed) also looked like EPIPE with no status line. So the fix must keep catching that bug.\n\nFix the test, not the server:\n- Treat EPIPE/ECONNRESET as the expected early close, not a failure in itself.\n- Still assert the 413 status line and the limit message whenever the response arrives; stop writing once response data arrives (or write with backpressure) so the client stops racing the close.\n- Keep a deterministic check that the server sent the 413 before closing even when the client cannot read it, for example by recording on the server side (in startBodyReadingServer) the status it wrote, so a server that hangs up without answering still fails the test.\n- Do not change MAX_REQUEST_BODY_BYTES, readBody or anything under packages/web/src.\n\nProof: run the file 20 times in a loop and under the full parallel web suite (npx vitest run --root packages/web). Force the race if you can (for example a slow-reading client or a server that destroys right after writing) to show the old test fails with EPIPE and the new one passes. Then show the regression check still bites: a temporary server that closes without a 413 must fail the new test; revert it before committing.\n\nTest-only: change the test file(s) named here and nothing in product code. If the flake turns out to be a real product bug, stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded; where cheap, force the condition locally to show the old test fails and the new one passes."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:28:50.510Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
