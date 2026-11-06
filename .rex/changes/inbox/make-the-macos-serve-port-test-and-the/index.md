---
id: "0cd4914e-f1cc-4305-b0d6-ce43a3e897a3"
type: "change"
title: "Make the macOS serve-port test and the compat-dependent viewer tests deterministic"
slug: "make-the-macos-serve-port-test-and-the"
intent: "Two tests failed CI intermittently on every branch, main included. graview-face's serve.test.ts probed a free port on 127.0.0.1 and then held it on localhost (::1 on macOS), so macOS's sequential port allocation handed it the port an earlier test's serve.js still held. In the web package's shared workers, whether preact/compat (which the dashboard always loads) was installed depended on which file ran first; compat rewires onBlur to focusout and onChange on text and range inputs to input, so add-item-form and throttle-controls passed or failed on scheduling. That also hid a dashboard bug: the concurrency slider sent a PUT, and disabled itself, on every step of a drag."
acceptanceCriteria:
  - "graview-face serve.test.ts holds ports the OS assigns and stops each serve.js before the next test"
  - "Every web jsdom test file runs with preact/compat loaded, as the dashboard does"
  - "The concurrency slider sends one PUT when a drag ends, none during it"
---
