---
"@n-dx/sourcevision": patch
---

Infrastructure discovery no longer reads Terraform or CloudFormation files under `tests/`, `__tests__/`, `fixtures/`, `__fixtures__/`, `testdata/` or `__mocks__/` directories, so a test fixture's `.tf` file stops appearing in `infrastructure.json`, on the iso map and in the readiness profile as if it were deployed. A directory named `test` is still read, because it is a common environment name.
