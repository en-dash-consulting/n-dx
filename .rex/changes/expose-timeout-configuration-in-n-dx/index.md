---
id: "4b559467-5391-4612-ab7d-27b71daac4dc"
type: "change"
title: "Expose timeout configuration in .n-dx.json schema and ndx config command"
slug: "expose-timeout-configuration-in-n-dx"
intent: "Add `cli.timeoutMs` and `cli.timeouts.*` keys to the .n-dx.json config schema with documentation, validation, and support through `ndx config get/set`. Ensure `ndx config --help` describes the timeout keys and their defaults."
acceptanceCriteria:
  - "`ndx config set cli.timeoutMs 3600000` persists the value to .n-dx.json and is read at next command invocation"
  - "`ndx config get cli.timeoutMs` prints the current value with its default noted if unset"
  - "The config schema validation rejects non-numeric or negative values with a descriptive error"
  - "`ndx config --help` lists all timeout-related keys with their defaults and descriptions"
  - "A unit test covers schema validation for valid, zero, and negative timeout values"
amends: [{"target":"888de653-60ad-43bf-843c-a859341d22a3","delta":"modified","summary":"Expose timeout configuration in .n-dx.json schema and ndx config command","base":"bf32114e37825ca5b1793afac8e7dcaae453c2413fc018af4710d5e8ee57bd7b"}]
priority: "medium"
tags:
  - "cli"
  - "config"
  - "timeout"
source: "smart-add"
---
