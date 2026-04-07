# CLI Smoke Parity

The macOS and Windows smoke jobs in [ci.yml](/Users/hal/Documents/VSCodeProjects/n-dx-1/.github/workflows/ci.yml) must run the same canonical `ndx` validation sequence by invoking:

```bash
node scripts/cli-smoke-parity.mjs collect --output <artifact-path>
```

`collect` defaults to running the source-checkout CLI entrypoint via the current Node executable. Use `--cli-command <command>` only when you explicitly need to exercise a separately installed CLI binary.

The collector records the canonical sequence in each artifact under `sequence`. That sequence is the documented baseline used by CI parity comparison.

## Canonical Sequence

1. `ndx version`
2. `ndx version --json`
3. `ndx foobar`
4. `ndx statis`
5. `ndx help rex`
6. `ndx help plan`
7. `ndx status <TMPDIR>` with an empty fixture
8. `ndx status --format=json <TMPDIR>` with a seeded `.rex` fixture

## Baseline Contract

Each step carries a stable expectation embedded in the artifact sequence:

- expected exit code
- required stdout or stderr substrings for text commands
- projected JSON contract for structured commands

`node scripts/cli-smoke-parity.mjs compare --mac <mac-artifact> --windows <windows-artifact>` validates:

- both artifacts were collected with the same canonical sequence metadata
- each platform still matches the baseline contract
- the comparable payloads are equal across macOS and Windows

When parity fails, the comparator reports the exact field path that diverged so CI surfaces a real contract diff instead of a generic platform failure.
