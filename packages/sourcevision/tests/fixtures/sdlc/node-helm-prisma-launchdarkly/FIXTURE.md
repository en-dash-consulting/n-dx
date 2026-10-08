# Node service with the full pipeline

A Node repository with GitHub Actions deploying via Helm, Prisma migrations and LaunchDarkly. Read by `tests/unit/analyzers/readiness-score.test.ts`, which asserts exact scores; change a file here only together with that test.

The `.hench/config.json` has no `guard`, which is what leaving hench's defaults in force looks like: repo-trust reports nothing wider than the baseline.
