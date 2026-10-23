---
id: "8abe3c45-9434-4862-aeee-0f56f107d130"
type: "capability"
title: "Runtime Process and Thread Lifecycle Enforcement"
slug: "runtime-process-and-thread-lifecycle"
statement: "n-dx tracks the worker threads and child processes each CLI command creates and tears them down on success, error and signal paths, so none outlive the command that started them."
criteria: [{"id":"c1","text":"When a CLI entry point (cli.js, ci.js, web.js or config.js) creates a worker thread, the entry point shall join or terminate that thread before the parent process exits, whether the command succeeds, fails or receives a signal."},{"id":"c2","text":"When `ndx analyze` or `ndx work` completes, the CLI shall leave no lingering node threads, and the thread count shall return to its baseline."},{"id":"c3","text":"When the CLI spawns a child process, the CLI shall register that child in a process registry at spawn time."},{"id":"c4","text":"When the parent command exits cleanly, on SIGINT or on an unhandled exception, the process registry shall send SIGTERM to every registered child and then SIGKILL to any child still running after a grace period."},{"id":"c5","text":"If a CLI run receives SIGINT mid-run, the CLI shall leave no orphan child processes running 5 seconds later."},{"id":"c6","text":"If the environment does not support process groups, the process registry shall act as a no-op and log a warning rather than crash."}]
source: "smart-add"
---

Ensure that no worker threads or child processes are left behind during normal n-dx operation — not just at exit. Covers the full command lifecycle: spawn, execution, and teardown for all CLI entry points.
