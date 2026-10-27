# Manifest

The `ndx.extension` block of the package's `package.json`. It is the only thing n-dx reads from an extension package before running it. The JSON Schema is `packages/core/extension-manifest.schema.json`. The validator, `packages/core/extension-manifest.js`, also checks what a schema cannot: names against built-in commands, semver range syntax, and link placeholders.

```json
{
  "ndx": {
    "extension": {
      "apiVersion": 1,
      "name": "hello",
      "displayName": "Hello",
      "ndxVersion": ">=0.10.0 <0.12.0",
      "commands": [{ "name": "hello", "bin": "bin/cli.js", "summary": "One line for ndx --help" }],
      "sidecar": { "bin": "bin/serve.js", "health": "/healthz", "idleStopMinutes": 15 },
      "hub": { "label": "Hello", "description": "One line for the hub home" },
      "projectLinks": [{ "label": "Hello", "path": "/project/{projectId}" }],
      "configSchema": "schema/config.json"
    }
  }
}
```

## Fields

| Field | Required | Rule |
| --- | --- | --- |
| `apiVersion` | yes | Integer. `1` is the only version today. A version n-dx does not speak is listed as incompatible and never run ([Versioning](./versioning.md)) |
| `name` | yes | Lowercase slug, at most 40 characters (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). It cannot be a built-in `ndx` command, a bin alias (`ndx`, `n-dx`, `rex`, `hench`, `sourcevision`, `sv`) or a reserved word (`ext`, `x`, `hub`, `extensions`, `paths`). Names the mount `/x/<name>/`, the state folder and the config section |
| `displayName` | no | Shown in listings and approval prompts |
| `ndxVersion` | yes | Semver range of n-dx versions the extension supports |
| `commands[]` | one of `commands` or `sidecar` | `name` becomes `ndx <name>` (same rules as `name` above). `bin` is a relative path inside the package. `summary` is one line, at most 100 characters, for `ndx --help` |
| `sidecar` | one of `commands` or `sidecar` | `bin` is the web server the hub mounts at `/x/<name>/`. `health` is a path polled for 200 before proxying (default `/`). `idleStopMinutes` is an integer of at least 1 (default 15) |
| `hub` | no, needs `sidecar` | `label` and optional `description` for the extension's card on the hub home |
| `projectLinks[]` | no, needs `sidecar` | `label` and `path` for a link in every project's dashboard header. `path` starts with `/` and resolves under `/x/<name>/`. `{projectId}` and `{repoRoot}` are the only placeholders, each URL-encoded |
| `configSchema` | no | Relative path inside the package to a JSON Schema for the extension's config section ([Config](./config.md)) |

Unknown fields are refused. A package path cannot be absolute or climb out of the package with `..`. No string, and not the package's own `name`, may contain a control character (newline, tab, escape sequence), and the package's `version` must be a semver version such as `1.0.0`: both are shown on the approval prompt, and `list`, `info` and the prompt print any control character from a package as a visible `\xNN` escape. Each problem is reported as one line that names the package, the JSON path, the rule and the fix.

## Where n-dx looks

Highest precedence first:

| Source | Location | Scope |
| --- | --- | --- |
| `project` | The project's `node_modules`, for packages its `package.json` lists | Commands run in that project |
| `user` | `<ndx home>/extensions/node_modules`, installed by `ndx extensions add` | Everywhere |
| `global` | The global `node_modules` n-dx itself was installed into. A `node_modules` with a `package.json` beside it is a project's and never the global source, except pnpm's global directory under `$PNPM_HOME/global` | Everywhere |
| `dev` | Package directories in `extensions.paths` of `<ndx home>/config.json`. Relative paths resolve against the home | Everywhere |

The n-dx home is `$NDX_HOME`, then `$N_DX_HOME`, then `~/.ndx`, then the legacy `~/.n-dx`.

- When one package is found in several sources, the highest source wins, and `ndx extensions info <name>` lists the others.
- Two different packages that claim one extension or command name are both refused, and each is shown naming the other.
- The hub serves sidecars from the `user`, `global` and `dev` sources only, because it serves no single project.

Discovery is cached in `<ndx home>/extensions.json`. It is recomputed when a source folder's modification time changes, or a found extension's own `package.json` does, so a new install, or an edit to a linked package's version or manifest, shows up on the next command.

## `ndx extensions`

| Command | Does |
| --- | --- |
| `list [--json]` | Every installed extension with its version, source, state and reason |
| `add <package>` | Installs into `<ndx home>/extensions`, with `--ignore-scripts`, without touching any project |
| `remove <name> [--purge]` | Uninstalls a user-source package and forgets its approval. `--purge` also deletes `<ndx home>/ext/<name>/` |
| `enable <name> [--yes]` | Approves (asks first, unless `--yes`) and clears `disable` |
| `disable <name>` | Hides the commands, card and links. Keeps the approval, config and state folder |
| `info <name> [--json]` | The manifest, its source, and any shadowed copies |
| `doctor [name]` | Checks every manifest, range, bin path and name clash. Prints one line per problem with its fix, and exits 1 on any problem |

A state is one of `enabled`, `disabled`, `unapproved`, `incompatible`, `invalid` or `conflict`. Only `enabled` runs.
