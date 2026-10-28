# Versioning

Two numbers let n-dx check compatibility without running any extension code.

| Number | Owned by | Meaning |
| --- | --- | --- |
| `apiVersion` | n-dx | The extension contract: the manifest, the [environment](./environment.md), the `/x/<name>/` proxy and the [versioned hub endpoints](./hub-api.md#versioned-api). It identifies the current contract, not a stability promise while extensions remain experimental. After promotion, a breaking change bumps it. n-dx supports the current version and the one before it. Today that is `1` only |
| `ndxVersion` | The extension | The semver range of n-dx releases the extension supports |

A mismatch on either leaves the extension listed but `incompatible`, with the reason shown in `ndx extensions list`, `ndx extensions doctor` and on the hub home. Its commands answer "Unknown command" with a hint, and its sidecar is not mounted.

## Current experimental contract

Extensions are **experimental until promoted** in the [public surface policy](../architecture/public-surface). `apiVersion: 1` is the current compatibility signal. The current contract covers:

- the manifest fields in [Manifest](./manifest.md);
- the variables in [Environment](./environment.md) and the command process rules (stdio, signals, exit code, working directory);
- the sidecar's `PORT`, `X-Ndx-Base-Path`, the stripped prefix, and hub credentials stripped from forwarded requests;
- the four endpoints in [Versioned API](./hub-api.md#versioned-api), whose listed fields only gain siblings;
- the `ndx` CLI commands it spawns through `NDX_BIN`, which follow n-dx's own release notes.

Nothing else is part of the contract. That includes `@n-dx/*` package internals, the layout of `<ndx home>/extensions.json`, and other files in the n-dx home. An extension reads `NDX_EXTENSION_API` at run time if it needs to know which contract it is running under.

## Choosing a range

Set `ndxVersion` to the releases you have tested, e.g. `">=0.10.0 <0.12.0"`. n-dx is pre-1.0, so a minor release may change CLI output that an extension parses. Prefer `--json` output where a command offers it.
