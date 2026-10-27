# Extensions

An extension is an npm package that adds `ndx <name>` commands, a web app the hub mounts at `/x/<name>/`, and links from each project's dashboard to that app. It declares all of this in an `ndx.extension` block in its `package.json`.

n-dx never imports extension code. It reads `package.json` to discover an extension, and runs its commands and sidecar as separate processes. An extension reaches n-dx only through public surfaces: spawning `ndx`, the hub API, and the project HTTP and MCP endpoints.

## Pages

| Page | Covers |
| --- | --- |
| [Minimal example](./example.md) | A working extension with one command and one sidecar, and the development loop |
| [Manifest](./manifest.md) | Every field of `ndx.extension`, where n-dx looks for packages, and `ndx extensions` |
| [Environment](./environment.md) | How a command runs, and the variables every extension process gets |
| [Hub and API](./hub-api.md) | The sidecar lifecycle, the `/x/<name>/` proxy, and the versioned hub endpoints |
| [Consent](./consent.md) | Approval before the first run, and what makes n-dx ask again |
| [Config](./config.md) | The extension's config section and its schema |
| [Versioning](./versioning.md) | `apiVersion`, `ndxVersion`, and what is stable |

## At a glance

```
package.json  ndx.extension  ──►  discovery (reads package.json only)
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
              ndx <name>                  hub  /x/<name>/
              spawns commands[].bin       spawns sidecar.bin on PORT
              stdio, signals, exit code   token checked, prefix stripped
```

- Nothing runs until the user approves the extension ([Consent](./consent.md)).
- A broken or incompatible extension is listed with its reason and never stops a built-in command or the hub.
- Extension commands work without a hub. Only sidecars and dashboard links need `ndx start`.

The design and its reasoning are in [docs/architecture/extensions.md](../architecture/extensions.md). Every contract rule has a test in `tests/e2e/extension-fixture.test.js`, which runs the fixture package `tests/e2e/fixture-extension/` through the real CLI and hub.
