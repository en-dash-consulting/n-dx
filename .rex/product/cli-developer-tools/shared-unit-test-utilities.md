---
id: "f9b208b6-43d9-44d3-a1cf-518e956aabd5"
type: "capability"
title: "Shared Unit Test Utilities"
slug: "shared-unit-test-utilities"
statement: "The unit test suites take repeated constants and helper functions from shared test-only utilities instead of redefining them in each file."
criteria: [{"id":"c1","text":"Unit test files shall use the shared test-only helpers and constants instead of defining their own copies."}]
source: "smart-add"
---

Reduce duplication across unit tests by consolidating repeated constants and helper functions into test-only shared utilities without changing production code or altering test coverage.
