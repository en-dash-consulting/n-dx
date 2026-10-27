# Environment

## Running a command

When `ndx <name>` matches no built-in command, n-dx finds the enabled extension command with that name and spawns its `bin`, passing the remaining arguments.

- **Node.** The `bin` runs on the same Node executable as n-dx (`process.execPath`). It needs no shebang and no executable bit.
- **Working directory.** The caller's directory, unchanged. n-dx resolves no project for the extension, and does not read its arguments as one.
- **No time limit.** n-dx's command timeout (`cli.timeoutMs`, `cli.timeouts.<command>`) applies to built-in commands only. An extension runs until it exits.
- **I/O and signals.** stdio is inherited, and `SIGINT` and `SIGTERM` are forwarded.
- **Exit code.** The extension's exit code becomes `ndx`'s. A command killed by a signal exits 128 plus the signal number.
- **Help.** `ndx --help` lists enabled extension commands under **Extensions** with their `summary`. `ndx <name> --help` goes to the extension.
- **Built-ins win.** An extension can never shadow a built-in command.
- **Refusals.** An extension that would run but must not yet exits **2**, with a message naming the problem and the fix. The cases are an unapproved manifest (in a terminal, n-dx asks first), a missing `bin`, and a config that breaks its schema. A disabled, incompatible (`apiVersion` or `ndxVersion`), invalid or conflicting extension gives the usual "Unknown command" error and exit 1, with a hint naming why and what to run.

## Variables

Every extension process, command or sidecar, gets the user's own environment plus:

| Variable | Value |
| --- | --- |
| `NDX_EXTENSION_API` | The contract version n-dx speaks (`1`) |
| `NDX_VERSION` | The running n-dx version |
| `NDX_BIN` | Absolute path to this install's `cli.js`. Run it with Node: `execFile(process.execPath, [process.env.NDX_BIN, ...args])` |
| `NDX_HOME` | The resolved n-dx home |
| `NDX_EXTENSION_NAME` | The manifest `name` |
| `NDX_EXTENSION_STATE_DIR` | `<ndx home>/ext/<name>/`, created before the process starts. The only n-dx-owned place the extension may write |
| `NDX_EXTENSION_CONFIG` | A JSON file holding the config section ([Config](./config.md)). A command gets a file of its own, removed when it exits; a sidecar gets `sidecar-config.json` |
| `NDX_HUB_URL` | The running hub's base URL, such as `http://localhost:3117`. Unset when no hub runs |
| `NDX_TOKEN_FILE` | The per-user token file. Set only with `NDX_HUB_URL`, and only when the file exists |

A sidecar also gets `PORT`, the loopback port it must listen on.

The token value itself is never in the environment. To call the hub, read `NDX_TOKEN_FILE` and send its contents as `X-Ndx-Token` (or `Authorization: Bearer`). If an extension runs `ndx` and that run starts another extension, these variables are replaced rather than inherited, so a stale hub URL never carries over.

## Talking to n-dx

Use these, and nothing else:

- **Spawn `NDX_BIN`** for any CLI command, such as `status`, `rex add` or `sv`. This always runs the same install that started the extension.
- **Call the hub** at `NDX_HUB_URL` for the [versioned endpoints](./hub-api.md#versioned-api).
- **Call a project** at `NDX_HUB_URL` + `/p/<id>/`, which serves its dashboard API and its MCP endpoints, `/mcp/rex` and `/mcp/sourcevision`.
- **Read documented files**, such as the PRD folder tree under `.rex/prd_tree/`.

Do not import `@n-dx/*` packages. Their internals are not part of the contract and change without notice.
