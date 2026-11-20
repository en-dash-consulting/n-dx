---
id: "63211e6a-29bf-4b6e-a69d-33cf10ddcbd2"
type: "task"
title: "Wrap smart-add-input test renders in act()"
slug: "wrap-smart-add-input-test-renders-in-act"
description: "packages/web/tests/unit/viewer/smart-add-input.test.ts leaves a preact frame-fallback timer (setTimeout 35) pending at afterAll on Linux and macOS: a render/update/unmount commits outside act(). Wrap it in act() from preact/test-utils, following packages/web/tests/helpers/preact-test-support.ts."
acceptanceCriteria:
  - "smart-add-input.test.ts passes with no pending preact timer at afterAll"
priority: "high"
source: "ndx-capture"
---
